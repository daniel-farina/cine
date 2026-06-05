/** Second-pass API: write CHARACTER: lines for each planned scene. */

import {
  applyPlanForMode,
  isNonDialogueNarrativeMode,
  resolveNarrativeMode,
} from "./briefNarrativeMode.js";
import { alignScenePlan } from "./sceneAlign.js";
import {
  applyDialogueFallbacks,
  normalizeDialogueText,
  shotsNeedingDialogue,
} from "./dialogueUtil.js";
import { isTransitionShot } from "./shotKind.js";
import { trimDialogueForClip } from "./storyFlow.js";

const MODE = { model: "grok-4.3", reasoning: { effort: "medium" } };

function buildDialogueSchema(count) {
  return {
    type: "object",
    properties: {
      lines: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          properties: {
            scene_index: { type: "integer", description: "0-based scene index" },
            dialogue: {
              type: "string",
              description:
                "dialogue shots: 1–2 SHORT CHARACTER: lines. transition shots: empty string.",
            },
          },
          required: ["scene_index", "dialogue"],
          additionalProperties: false,
        },
      },
    },
    required: ["lines"],
    additionalProperties: false,
  };
}

const DIALOGUE_SYSTEM = `You are a screenwriter. Output JSON only.
Rules:
- Each timeline clip is ~10 seconds of video. Dialogue must be lip-syncable in that time.
- Only write dialogue for shots listed as dialogue — skip transition shots (empty string).
- Per dialogue shot: 1–2 lines MAX (one short exchange). Under 12 words per line. No monologues.
- Format: SHORT_NAME: dialogue (TESLA, ELON, etc.).
- Lines must advance the story_spine and match what is visible in scene_prompt — no random topics.
- Original dialogue only — no quotes from other films unless the brief requests homage.`;

function extractOutputText(data) {
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (c.type === "output_text" && c.text) return c.text;
    }
  }
  if (data.output_text) return data.output_text;
  return null;
}

function buildDialogueUserMessage({ brief, plan }) {
  const parts = [
    `Film brief:\n${brief.trim()}`,
    `Look bible:\n${plan.lookBible}`,
    `Write dialogue only for dialogue shots (skip transition). scene_index 0 .. ${plan.shots.length - 1}. Max 2 short lines per dialogue scene:`,
  ];
  plan.shots.forEach((s, i) => {
    const kind = isTransitionShot(s) ? "transition (no dialogue)" : "dialogue";
    parts.push(`Scene ${i} [${kind}] — ${s.label}:\n${s.scenePrompt}`);
  });
  return parts.join("\n\n");
}

function mergeDialogueLines(plan, lines) {
  const byIndex = new Map();
  for (const row of lines || []) {
    const idx = Number(row.scene_index);
    const d = String(row.dialogue || "").trim();
    if (Number.isInteger(idx) && idx >= 0 && idx < plan.shots.length && d) {
      byIndex.set(idx, normalizeDialogueText(trimDialogueForClip(d)));
    }
  }
  return {
    ...plan,
    shots: plan.shots.map((s, i) => {
      if (isTransitionShot(s)) return { ...s, dialogue: "" };
      const d = byIndex.get(i) || s.dialogue;
      return { ...s, dialogue: trimDialogueForClip(d) };
    }),
  };
}

export async function enrichScenePlanDialogue({ apiBase, apiKey, brief, plan }) {
  if (!shotsNeedingDialogue(plan.shots).length) return plan;

  const n = plan.shots.length;
  const res = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODE.model,
      reasoning: MODE.reasoning,
      store: false,
      input: [
        { role: "system", content: DIALOGUE_SYSTEM },
        { role: "user", content: buildDialogueUserMessage({ brief, plan }) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "scene_dialogue",
          schema: buildDialogueSchema(n),
          strict: true,
        },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("[sceneDialogue] API error:", data?.error?.message || res.statusText);
    return applyDialogueFallbacks(plan, brief);
  }

  const text = extractOutputText(data);
  if (!text) return applyDialogueFallbacks(plan, brief);

  try {
    const parsed = JSON.parse(text);
    const merged = mergeDialogueLines(plan, parsed.lines);
    return applyDialogueFallbacks(merged, brief);
  } catch (e) {
    console.warn("[sceneDialogue] parse error:", e.message);
    return applyDialogueFallbacks(plan, brief);
  }
}

export async function finalizeScenePlan(plan, ctx) {
  const { apiBase, apiKey, brief, narrativeMode: narrativeModeIn, narrativeModes } = ctx;
  const narrativeMode = narrativeModeIn || resolveNarrativeMode(brief, undefined, narrativeModes);
  if (isNonDialogueNarrativeMode(narrativeMode, narrativeModes)) {
    return applyPlanForMode(plan, narrativeMode, narrativeModes);
  }
  let next = plan;
  if (apiKey && shotsNeedingDialogue(plan.shots).length) {
    try {
      next = await enrichScenePlanDialogue({ apiBase, apiKey, brief, plan });
    } catch (e) {
      console.warn("[sceneDialogue] enrich failed:", e.message);
      next = applyDialogueFallbacks(plan, brief);
    }
  } else {
    next = applyDialogueFallbacks(plan, brief);
  }
  if (apiKey) {
    try {
      next = await alignScenePlan({
        apiBase,
        apiKey,
        brief,
        plan: next,
        narrativeMode,
        narrativeModes,
      });
    } catch (e) {
      console.warn("[sceneAlign] failed:", e.message);
    }
  }
  return next;
}