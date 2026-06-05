/** Scene planning via xAI Responses API (structured JSON + optional SSE). */

import {
  applyPlanForMode,
  filterSystemRulesForNarrative,
  isSilentStylePlanMode,
  plannerAppendixForMode,
  resolveNarrativeMode,
} from "./briefNarrativeMode.js";
import { normalizeDialogueText } from "./dialogueUtil.js";
import { finalizeScenePlan } from "./sceneDialogue.js";
import { normalizeShotKind } from "./shotKind.js";
import {
  buildClipDurationPlannerBlock,
  DEFAULT_CLIP_SECONDS,
  normalizePlanForClipDuration,
} from "./storyFlow.js";

const SCENE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", description: "Short scene title for the timeline" },
    shot_kind: {
      type: "string",
      enum: ["dialogue", "transition"],
      description:
        "dialogue = characters talk in place. transition = silent movement only between dialogue beats (walk, open door, enter vehicle, camera push-in) — dialogue must be empty.",
    },
    scene_prompt: {
      type: "string",
      minLength: 120,
      description:
        "Detailed frozen still for image gen. Scene 1 (shot 0): look_bible + FRAME COMPOSITION (camera angle, left/center/right placement of each subject, eyelines, foreground/mid/background, vehicle/prop positions) + wardrobe/props — 100–180 words. Scenes 2+: 'Same scene, then' + what changed. Static poses only. No camera moves.",
    },
    action_prompt: {
      type: "string",
      description:
        "Video ONLY — one prose line: body movement with speech woven in. Example: Elon walks toward the Cybertruck as Elon says \"let me see this\", Tesla pivots to follow. transition: silent movement only. No camera grammar.",
    },
    camera_prompt: {
      type: "string",
      description:
        "Video ONLY — camera position, lens, one gradual move (dolly/pan/crane). No body action, no scene description.",
    },
    sound_prompt: {
      type: "string",
      description: "Diegetic sound / ambience only, no music unless brief asks",
    },
    dialogue: {
      type: "string",
      description:
        "dialogue shots: 1–2 SHORT lines only (CHARACTER: under 12 words each). transition shots: empty string only.",
    },
    story_beat: {
      type: "string",
      enum: ["establish", "continue", "react", "speak", "move", "reveal", "payoff"],
      description: "Where this clip sits in the story arc",
    },
    continuity_in: {
      type: "string",
      description:
        "What carries from the previous clip: positions, props, emotion, location (empty on shot 0)",
    },
    end_state: {
      type: "string",
      description:
        "Frozen END pose after this ~10s clip — next shot must bridge from here",
    },
  },
  required: [
    "label",
    "shot_kind",
    "scene_prompt",
    "action_prompt",
    "camera_prompt",
    "sound_prompt",
    "dialogue",
    "story_beat",
    "continuity_in",
    "end_state",
  ],
  additionalProperties: false,
};

export function buildScenePlanSchema(sceneCount = 12) {
  const n = Math.min(24, Math.max(1, Number(sceneCount) || 12));
  return {
    type: "object",
    properties: {
      look_bible: {
        type: "string",
        description:
          "30–80 word visual lock: medium, palette, grain, lens, era. Repeat verbatim in scene 1 scene_prompt.",
      },
      story_spine: {
        type: "string",
        description:
          "1–2 sentences: setup → complication → turn → resolution. Every shot must serve this arc.",
      },
      shots: {
        type: "array",
        description: `Exactly ${n} scenes in narrative order for a film timeline`,
        minItems: n,
        maxItems: n,
        items: SCENE_ITEM_SCHEMA,
      },
    },
    required: ["look_bible", "story_spine", "shots"],
    additionalProperties: false,
  };
}

export const SCENE_PLAN_SCHEMA = buildScenePlanSchema(12);

export const PLANNER_SYSTEM = `You are a senior film editor planning a sequential timeline for xAI Grok Imagine (2K keyframes + image-to-video). Each planned scene becomes ONE stitched clip in a short film.

Output JSON only. Rules for consistency and less "AI slop":
- look_bible: one rigid visual lock (medium, color grade, grain, lens, era). Every scene_prompt MUST begin with the exact look_bible text, then add only shot-specific subject/action/environment.
- scene_prompt: ONE frozen instant, richly described. Static poses only — no motion verbs. If dialogue will mention a component, it MUST be visible or clearly gestured toward in this still. Camera moves go in camera_prompt only.
- Shot 1 scene_prompt is the master keyframe for the whole timeline: after look_bible, spell out FRAME COMPOSITION — shot size (wide/medium/close), camera height, and exact spatial layout (e.g. character A on the left third facing right; character B on the right facing left; vehicle centered; prop on foreground table). Never vague "two people in a room" without left/right, depth, and eyelines.
- action_prompt: single video performance line — movement plus embedded quotes (Character says \"line\"). Never put action or speech in scene_prompt.
- camera_prompt: ONLY camera grammar (e.g. "slow pan right, eye level, 35mm"). No body action.
- Shots 2+ use a bridged reference frame for images — scene_prompt is beat staging (end pose, static) for script sync, NOT sent as the image API prompt.
- sound_prompt: diegetic audio only unless brief requests score.
- Avoid: oversaturated HDR, plastic skin, random text/watermarks, extra limbs, morphing faces, stock-photo poses.
- Order shots for narrative flow (establish → develop → payoff).
- Think one shot ahead: stage props and vehicles for upcoming action (e.g. car facing the exit before someone drives away). Linked scenes stay related — no unrelated drastic changes.
- Name main characters when they appear; if faces are visible, describe faces; back turned / far away / silhouette — naming faces is optional.
- shot_kind alternation: use dialogue and transition shots in rhythm so characters are NOT stuck in one pose. Typical pattern: dialogue (talk) → transition (silent move: walk to door, open door, get in vehicle, camera dolly in) → dialogue (talk in new position) → transition → … For 8+ scenes, roughly half should be transition.
- dialogue shots: 1–2 SHORT lines max, CHARACTER: format. transition shots: dialogue MUST be "" (empty); action_prompt has the move; mouths closed.
- transition scene_prompt: frozen END pose after the move (staging reference only for shot 2+).
- story_spine + per-shot continuity_in / end_state are mandatory — this is how clips stay coherent when stitched.`;

function formatPlannerRulesBlock(systemRules) {
  const active = (systemRules || []).map((r) => String(r).trim()).filter(Boolean);
  if (!active.length) return "";
  return `\n\nProject generation rules (follow for every scene_prompt):\n${active.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}

const MODE_MAP = {
  quick: { model: "grok-4.3", reasoning: { effort: "low" } },
  cinematic: { model: "grok-4.3", reasoning: { effort: "medium" } },
  deep: { model: "grok-4.3", reasoning: { effort: "high" } },
  multi_agent: { model: "grok-4.20-multi-agent", reasoning: { effort: "low" } },
  multi_agent_deep: { model: "grok-4.20-multi-agent", reasoning: { effort: "high" } },
};

export function buildPlannerSystemMessage(
  systemRules,
  brief = "",
  narrativeMode = null,
  narrativeModes = null,
  clipDurationSeconds = DEFAULT_CLIP_SECONDS
) {
  const registry = narrativeModes;
  const mode = narrativeMode || resolveNarrativeMode(brief, undefined, registry);
  const rules = filterSystemRulesForNarrative(systemRules, mode, registry);
  let msg =
    PLANNER_SYSTEM +
    buildClipDurationPlannerBlock(clipDurationSeconds) +
    plannerAppendixForMode(mode, registry);
  return msg + formatPlannerRulesBlock(rules);
}

export function summarizeScenesForPlanner(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) return "";
  const tail = scenes.slice(-5);
  const offset = scenes.length - tail.length;
  const blocks = tail.map((s, i) => {
    const n = offset + i + 1;
    const lines = [`Scene ${n} — ${s.title || `Scene ${n}`}`];
    if (s.shotKind) lines.push(`Type: ${s.shotKind}`);
    const beat = (s.visualBeat || s.imagePrompt || "").trim();
    if (beat && !/^same image[,.]?\s+high\s+quality/i.test(beat)) {
      lines.push(`Staging: ${beat.slice(0, 320)}`);
    }
    if (s.dialogue?.trim()) lines.push(`Dialogue: ${s.dialogue.trim().slice(0, 240)}`);
    if (s.videoPrompt?.trim()) lines.push(`Video action: ${s.videoPrompt.trim().slice(0, 200)}`);
    if (s.motionPrompt?.trim()) lines.push(`Camera: ${s.motionPrompt.trim().slice(0, 120)}`);
    return lines.join("\n");
  });
  let out = blocks.join("\n\n");
  if (scenes.length > tail.length) {
    out = `(${scenes.length - tail.length} earlier scene(s) omitted)\n\n${out}`;
  }
  return out;
}

export function sanitizePlannerBrief(brief) {
  return String(brief || "")
    .replace(/\[Image\s*#\d+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildPlannerUserMessage({
  brief,
  shotCount,
  aspectRatio,
  continuation,
  narrativeMode: narrativeModeIn,
  narrativeModes,
  clipDurationSeconds = DEFAULT_CLIP_SECONDS,
}) {
  const clipSec = Math.min(15, Math.max(4, Number(clipDurationSeconds) || DEFAULT_CLIP_SECONDS));
  const n = Math.min(24, Math.max(1, Number(shotCount) || 12));
  const append = Boolean(continuation?.append && continuation.existingCount > 0);
  const existingCount = append ? Number(continuation.existingCount) || 0 : 0;
  const cleanBrief = sanitizePlannerBrief(brief);
  if (!cleanBrief) throw new Error("Film brief is empty after removing image placeholders");
  const narrativeMode =
    narrativeModeIn || resolveNarrativeMode(cleanBrief, undefined, narrativeModes);
  const nonDialogueBrief = isSilentStylePlanMode(narrativeMode, narrativeModes);

  const lines = [
    `Clip duration: ${clipSec} seconds per scene (image-to-video). Plan motion and dialogue for that length only.`,
    `Creative brief:\n${cleanBrief}`,
    nonDialogueBrief
      ? "NARRATIVE MODE: NON-DIALOGUE — honor the selected studio mode. No invented conversations unless the brief explicitly requires speech. Prefer movement, atmosphere, and visual beats."
      : null,
    append
      ? `You MUST return exactly ${n} NEW scenes in shots[] — these continue the existing ${existingCount}-scene timeline. Do not rewrite or repeat earlier beats.`
      : `You MUST return exactly ${n} scenes in shots[] — no more, no fewer.`,
    append
      ? `The first shot in your response is scene ${existingCount + 1} — continue immediately from where scene ${existingCount} left off (same story, locations, and character arcs unless the brief says otherwise).`
      : "Each scene should advance the story beat-by-beat so the timeline flows when stitched (establish → rising action → climax → resolution as appropriate).",
  ];

  if (append) {
    if (continuation.lookBible?.trim()) {
      lines.push(
        `Existing look_bible (keep visual continuity — repeat verbatim in your new shot 1 scene_prompt, then add composition):\n${continuation.lookBible.trim()}`
      );
    }
    if (continuation.scenesSummary?.trim()) {
      lines.push(`Where the timeline left off:\n${continuation.scenesSummary.trim()}`);
    }
    if (continuation.lastSceneTitle) {
      lines.push(
        `Last scene on timeline: "${continuation.lastSceneTitle}". Your new shots[0] must be the very next story beat after that moment.`
      );
    }
    lines.push(
      "For ALL new scenes in this batch: scene_prompt must start with 'Same scene, then' (bridged reference stills). Maintain alternating dialogue / transition rhythm with the prior timeline."
    );
  }

  if (aspectRatio) lines.push(`Target aspect ratio for framing: ${aspectRatio}.`);
  lines.push(
    append
      ? "Return look_bible (may match existing) plus shots[] for the NEW scenes only. New shot 1 scene_prompt: look_bible + composition OR 'Same scene, then' + end pose. New shots 2+ in this batch: 'Same scene, then'. camera_prompt is camera-only."
      : "Return look_bible plus shots[]. Scene 1 scene_prompt starts with look_bible, then a precise composition map (who is left/center/right, facing whom, depth layers, where vehicles/props sit). Scenes 2+ scene_prompt must start with 'Same scene, then'. camera_prompt is camera-only for every scene."
  );
  lines.push(
    nonDialogueBrief
      ? "ALL shots: shot_kind transition, dialogue empty. action_prompt = environmental/subject motion only. camera_prompt = lens move only."
      : "Alternate dialogue and transition shots. transition = empty dialogue + action_prompt (body) + camera_prompt (lens/move). Never put walking/stepping/pan/dolly in scene_prompt — static poses only. Props in dialogue must appear in scene_prompt."
  );
  return lines.filter(Boolean).join("\n\n");
}

function inferDialogueFromText(text) {
  const lines = [];
  const re = /(?:^|[\n.])\s*([A-Z][A-Za-z0-9][A-Za-z0-9 .'-]{0,24}):\s*([^\n.]{4,200})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = `${m[1].trim()}: ${m[2].trim()}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.join("\n");
}

function coerceDialogue(scenePrompt, dialogue) {
  const d = String(dialogue || "").trim();
  if (d.length >= 8) return d;
  const inferred = inferDialogueFromText(scenePrompt || "");
  if (inferred.length >= 8) return inferred;
  return d;
}

function extractOutputText(data) {
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type === "output_text" && c.text) return c.text;
      if (c.text && typeof c.text === "string") return c.text;
    }
  }
  if (data.output_text) return data.output_text;
  if (typeof data.text === "string" && data.text.trim()) return data.text;
  return null;
}

function extractStreamTextDelta(payload) {
  if (!payload || typeof payload !== "object") return "";
  const t = String(payload.type || "");
  // .done events carry the full body — handled separately to avoid duplicating deltas.
  if (t.includes(".done")) return "";
  if (typeof payload.delta === "string" && payload.delta) {
    if (
      t.includes("output_text.delta") ||
      t.includes("text.delta") ||
      t.includes("content_part.delta")
    ) {
      return payload.delta;
    }
  }
  return "";
}

function stripPlanCodeFences(text) {
  const t = String(text || "").trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

/** Parse plan JSON when the model streams duplicate objects or trailing prose. */
export function extractPlanJsonObject(raw) {
  const text = stripPlanCodeFences(raw);
  if (!text) throw new Error("Empty plan JSON");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    if (start < 0) throw new Error("No JSON object in plan response");
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(text.slice(start, i + 1));
        }
      }
    }
    throw new Error("Incomplete JSON object in plan response");
  }
}

export function parseScenePlan(raw, options = {}) {
  const parsed = typeof raw === "string" ? extractPlanJsonObject(raw) : raw;
  if (!parsed?.look_bible || !Array.isArray(parsed.shots)) {
    throw new Error("Invalid scene plan shape");
  }
  const silentPlan = isSilentStylePlanMode(
    options.narrativeMode,
    options.narrativeModes
  );
  return {
    lookBible: String(parsed.look_bible).trim(),
    storySpine: String(parsed.story_spine || "").trim(),
    shots: parsed.shots.map((s, i) => {
      const shotKind = silentPlan ? "transition" : normalizeShotKind(s.shot_kind);
      const dialogue =
        shotKind === "transition" || silentPlan
          ? ""
          : normalizeDialogueText(coerceDialogue(s.scene_prompt, s.dialogue));
      return {
        label: String(s.label || `Step ${i + 1}`).trim(),
        shotKind,
        scenePrompt: String(s.scene_prompt || "").trim(),
        actionPrompt: String(s.action_prompt || "").trim(),
        cameraPrompt: String(s.camera_prompt || "").trim(),
        soundPrompt: String(s.sound_prompt || "").trim(),
        dialogue,
        storyBeat: String(s.story_beat || "").trim(),
        continuityIn: String(s.continuity_in || "").trim(),
        endState: String(s.end_state || "").trim(),
      };
    }),
  };
}

function finalizeParsedPlan(plan, clipDurationSeconds) {
  return normalizePlanForClipDuration(plan, clipDurationSeconds);
}

export async function planScenes({
  apiBase,
  apiKey,
  mode = "cinematic",
  brief,
  shotCount = 12,
  aspectRatio,
  systemRules,
  continuation,
  narrativeMode: narrativeModePreference,
  narrativeModes,
  clipDurationSeconds = DEFAULT_CLIP_SECONDS,
}) {
  const cfg = MODE_MAP[mode] || MODE_MAP.cinematic;
  const schema = buildScenePlanSchema(shotCount);
  const clipSec = Math.min(15, Math.max(4, Number(clipDurationSeconds) || DEFAULT_CLIP_SECONDS));
  const resolvedMode = resolveNarrativeMode(brief, narrativeModePreference, narrativeModes);
  const res = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      reasoning: cfg.reasoning,
      store: false,
      input: [
        {
          role: "system",
          content: buildPlannerSystemMessage(
            systemRules,
            brief,
            resolvedMode,
            narrativeModes,
            clipSec
          ),
        },
        {
          role: "user",
          content: buildPlannerUserMessage({
            brief,
            shotCount,
            aspectRatio,
            continuation,
            narrativeMode: resolvedMode,
            narrativeModes,
            clipDurationSeconds: clipSec,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scene_plan",
          schema,
          strict: true,
        },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      JSON.stringify(data).slice(0, 240) ||
      res.statusText;
    throw new Error(`xAI ${res.status}: ${detail}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("No structured plan in response");
  const narrativeMode = resolvedMode;
  let plan = finalizeParsedPlan(
    parseScenePlan(text, { narrativeMode, narrativeModes }),
    clipSec
  );
  plan = applyPlanForMode(plan, narrativeMode, narrativeModes);
  const expected = Math.min(24, Math.max(1, Number(shotCount) || 12));
  if (plan.shots.length !== expected) {
    throw new Error(`Expected ${expected} scenes, got ${plan.shots.length}`);
  }
  plan = await finalizeScenePlan(plan, {
    apiBase,
    apiKey,
    brief,
    narrativeMode,
    narrativeModes,
  });
  return plan;
}

function emitPartialShots(jsonAccum, sentLabels, send) {
  const labels = [...jsonAccum.matchAll(/"label"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
  for (let i = sentLabels; i < labels.length; i++) {
    let label = labels[i][1];
    try {
      label = JSON.parse(`"${label}"`);
    } catch {
      /* keep raw */
    }
    send("shot", { index: i, label });
  }
  return labels.length;
}

/** Stream reasoning + partial shots + final plan via SSE `send(event, payload)`. */
export async function planScenesStream({
  apiBase,
  apiKey,
  mode,
  brief,
  shotCount,
  aspectRatio,
  systemRules,
  continuation,
  narrativeMode: narrativeModePreference,
  narrativeModes,
  clipDurationSeconds = DEFAULT_CLIP_SECONDS,
  res,
  send: sendFn,
}) {
  const { createPlanLogger, summarizePlan } = await import("./planLog.js");
  const send =
    sendFn ||
    ((event, payload) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    });
  const log = createPlanLogger((event, payload) => {
    try {
      return send(event, payload);
    } catch {
      return false;
    }
  });

  const cfg = MODE_MAP[mode] || MODE_MAP.cinematic;
  const schema = buildScenePlanSchema(shotCount);
  const resolvedMode = resolveNarrativeMode(brief, narrativeModePreference, narrativeModes);
  const clipSec = Math.min(15, Math.max(4, Number(clipDurationSeconds) || DEFAULT_CLIP_SECONDS));
  const eventTypesSeen = new Set();

  log.info("plan_stream_start", {
    mode,
    model: cfg.model,
    reasoning: cfg.reasoning,
    shotCount,
    aspectRatio,
    clipDurationSeconds: clipSec,
    continuation: continuation?.append ? continuation.existingCount : 0,
  });

  send("phase", { message: "Connecting to Grok planner…" });

  const upstream = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      reasoning: cfg.reasoning,
      store: false,
      stream: true,
      input: [
        {
          role: "system",
          content: buildPlannerSystemMessage(
            systemRules,
            brief,
            resolvedMode,
            narrativeModes,
            clipSec
          ),
        },
        {
          role: "user",
          content: buildPlannerUserMessage({
            brief,
            shotCount,
            aspectRatio,
            continuation,
            narrativeMode: resolvedMode,
            narrativeModes,
            clipDurationSeconds: clipSec,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scene_plan",
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    log.error("plan_upstream_error", {
      status: upstream.status,
      detail: err?.error?.message || err?.message || upstream.statusText,
    });
    throw new Error(err?.error?.message || err?.message || upstream.statusText);
  }

  send("phase", { message: "Thinking through beats and camera…" });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let jsonAccum = "";
  let sentLabels = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      let eventType = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine || dataLine === "[DONE]") continue;

      let payload;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }

      if (payload.type) eventTypesSeen.add(payload.type);

      if (payload.type === "response.reasoning_summary_text.delta" && payload.delta) {
        send("reasoning", { delta: payload.delta });
      }

      const textDelta = extractStreamTextDelta(payload);
      if (textDelta) {
        jsonAccum += textDelta;
        send("text", { delta: textDelta });
        sentLabels = emitPartialShots(jsonAccum, sentLabels, send);
      }

      if (payload.type === "response.output_text.done") {
        const doneText =
          (typeof payload.text === "string" && payload.text) ||
          (typeof payload.part?.text === "string" && payload.part.text) ||
          "";
        if (doneText) {
          jsonAccum = doneText;
          sentLabels = emitPartialShots(jsonAccum, 0, send);
        }
      }

      if (payload.type === "response.completed" || payload.type === "response.done") {
        const text = extractOutputText(payload.response || payload) || extractOutputText(payload);
        if (text) {
          jsonAccum = text;
          sentLabels = emitPartialShots(jsonAccum, 0, send);
        }
      }
    }
  }

  let parsedLen = 0;
  try {
    parsedLen = JSON.stringify(extractPlanJsonObject(jsonAccum)).length;
  } catch {
    /* logged below */
  }

  log.info("plan_stream_end", {
    jsonLen: jsonAccum.length,
    parsedLen,
    labelsParsed: sentLabels,
    eventTypes: [...eventTypesSeen].slice(0, 12),
  });

  if (jsonAccum.trim()) {
    try {
      send("phase", { message: "Writing script & aligning with visuals…" });
      const narrativeMode = resolvedMode;
      let plan = finalizeParsedPlan(
        parseScenePlan(jsonAccum, { narrativeMode, narrativeModes }),
        clipSec
      );
      plan = applyPlanForMode(plan, narrativeMode, narrativeModes);
      log.info("plan_parsed", { ...summarizePlan(plan), narrativeMode });
      try {
        plan = await finalizeScenePlan(plan, {
          apiBase,
          apiKey,
          brief,
          narrativeMode,
          narrativeModes,
        });
        log.info("plan_finalized", summarizePlan(plan));
      } catch (e) {
        log.warn("plan_finalize_failed_using_raw", { error: e.message });
      }
      send("plan", plan);
    } catch (e) {
      log.error("plan_parse_failed", {
        error: e.message,
        jsonTail: jsonAccum.slice(-400),
      });
      send("error", { message: String(e.message) });
    }
  } else {
    log.error("plan_empty_json", {
      eventTypes: [...eventTypesSeen],
      hint: "Try cinematic planner mode if multi-agent returned no structured JSON",
    });
    send("error", {
      message:
        "Planner returned no structured JSON (stream ended empty). Try Settings → Planner: Cinematic, or fewer scenes.",
    });
  }

  send("done", {});
}