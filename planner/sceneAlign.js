/** Align still-frame description (scene_prompt) with dialogue for each shot. */

import { isSilentObservationalBrief } from "./briefNarrativeMode.js";
import { normalizeDialogueText } from "./dialogueUtil.js";
import { isTransitionShot } from "./shotKind.js";
import { sanitizeStillImagePrompt } from "./staticImagePrompt.js";

const MODE = { model: "grok-4.3", reasoning: { effort: "medium" } };

function buildAlignSchema(count) {
  return {
    type: "object",
    properties: {
      shots: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          properties: {
            scene_index: { type: "integer" },
            scene_prompt: {
              type: "string",
              description:
                "Still for image gen. Shot 0: full composition map (left/right/center, eyelines, depth). Later shots: Same scene, then…",
            },
            dialogue: {
              type: "string",
              description: "Lines only about what is visible in scene_prompt",
            },
          },
          required: ["scene_index", "scene_prompt", "dialogue"],
          additionalProperties: false,
        },
      },
    },
    required: ["shots"],
    additionalProperties: false,
  };
}

const ALIGN_SYSTEM = `You are a film continuity editor. Output JSON only.

For each shot, expand and align scene_prompt (visual) and dialogue (script):
- scene_prompt: FROZEN STILL, richly detailed. Shot 0 (first keyframe): 100–180 words with explicit FRAME COMPOSITION — shot size, camera height, left/center/right placement of every person and major prop, who faces whom, foreground vs background. Fix vague layouts; never leave subject positions implicit. Shots 2+: 50+ words, keep "Same scene, then". Static poses only — no camera motion, no action verbs.
- If dialogue mentions any prop, vehicle part, or tech (battery, flux capacitor, door, screen, coil, etc.), scene_prompt MUST show that item clearly in frame or in a gesture toward it.
- dialogue shots: FULL exchange — at least 4 CHARACTER: lines. transition shots: dialogue MUST stay empty.
- Dialogue may only reference what is visible in scene_prompt.
- Keep "Same scene, then" on shots 2+ when present.
- No movie catchphrase quotes unless the brief requires homage.`;

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

function buildAlignUserMessage({ brief, plan }) {
  const parts = [
    `Film brief:\n${brief.trim()}`,
    `Align visual + script for ${plan.shots.length} shots:`,
  ];
  plan.shots.forEach((s, i) => {
    parts.push(
      `Shot ${i} (${s.label}):\nVISUAL:\n${s.scenePrompt}\n\nSCRIPT:\n${s.dialogue || "(empty)"}`
    );
  });
  return parts.join("\n\n");
}

function mergeAlignedPlan(plan, shots) {
  const byIndex = new Map();
  for (const row of shots || []) {
    const idx = Number(row.scene_index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= plan.shots.length) continue;
    byIndex.set(idx, {
      scenePrompt: String(row.scene_prompt || "").trim(),
      dialogue: normalizeDialogueText(String(row.dialogue || "")),
    });
  }
  return {
    ...plan,
    shots: plan.shots.map((s, i) => {
      const a = byIndex.get(i);
      if (!a) return s;
      const transition = isTransitionShot(s);
      return {
        ...s,
        scenePrompt: sanitizeStillImagePrompt(a.scenePrompt || s.scenePrompt),
        dialogue: transition ? "" : a.dialogue || s.dialogue,
      };
    }),
  };
}

export async function alignScenePlan({ apiBase, apiKey, brief, plan }) {
  if (isSilentObservationalBrief(brief)) return plan;
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
        { role: "system", content: ALIGN_SYSTEM },
        { role: "user", content: buildAlignUserMessage({ brief, plan }) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "aligned_scene_plan",
          schema: buildAlignSchema(n),
          strict: true,
        },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn("[sceneAlign] API error:", data?.error?.message || res.statusText);
    return plan;
  }

  const text = extractOutputText(data);
  if (!text) return plan;

  try {
    const parsed = JSON.parse(text);
    return mergeAlignedPlan(plan, parsed.shots);
  } catch (e) {
    console.warn("[sceneAlign] parse error:", e.message);
    return plan;
  }
}

/** Align one scene's image prompt + dialogue (inspector sync button). */
export async function alignScenePair({
  apiBase,
  apiKey,
  brief,
  title,
  imagePrompt,
  dialogue,
}) {
  const plan = {
    lookBible: "",
    shots: [
      {
        label: title || "Scene",
        scenePrompt: imagePrompt,
        cameraPrompt: "",
        soundPrompt: "",
        dialogue: dialogue || "",
      },
    ],
  };
  const aligned = await alignScenePlan({
    apiBase,
    apiKey,
    brief: brief || "",
    plan,
  });
  const s = aligned.shots[0];
  return { imagePrompt: s.scenePrompt, dialogue: s.dialogue };
}