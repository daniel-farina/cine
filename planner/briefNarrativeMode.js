/** Infer whether the film brief wants dialogue-driven scenes or silent/observational story. */

export const NARRATIVE_AUTO = "auto";
export const NARRATIVE_DIALOGUE = "dialogue_driven";
export const NARRATIVE_SILENT = "silent_observational";
export const NARRATIVE_NATURE = "nature_wildlife";

const KNOWN_NARRATIVE_MODES = new Set([
  NARRATIVE_DIALOGUE,
  NARRATIVE_SILENT,
  NARRATIVE_NATURE,
]);

const NON_DIALOGUE_BEHAVIORS = new Set(["silent", "nature", "non_dialogue"]);

/** Normalize studio narrative mode list from API / settings. */
export function normalizeNarrativeModeRegistry(modes) {
  if (!Array.isArray(modes) || !modes.length) return null;
  const out = [];
  const seen = new Set();
  for (const raw of modes) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const behavior = String(raw.behavior || "dialogue").trim();
    out.push({
      id,
      label: String(raw.label || id).trim(),
      description: String(raw.description || "").trim(),
      behavior: ["auto", "dialogue", "silent", "nature", "non_dialogue"].includes(behavior)
        ? behavior
        : "dialogue",
      plannerAppendix: raw.plannerAppendix ? String(raw.plannerAppendix) : "",
      inferKeywords: Array.isArray(raw.inferKeywords)
        ? raw.inferKeywords.map((k) => String(k).trim()).filter(Boolean)
        : [],
    });
  }
  return out.length ? out : null;
}

export function getModeDef(modeId, registry) {
  if (registry?.length) {
    return registry.find((m) => m.id === modeId) || null;
  }
  return null;
}

function scoreBriefAgainstMode(text, mode) {
  const kws = mode.inferKeywords || [];
  if (!kws.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of kws) {
    const k = String(kw).toLowerCase().trim();
    if (k && lower.includes(k)) score += 1;
  }
  return score;
}

function inferFromRegistry(brief, registry) {
  const text = String(brief || "").trim();
  if (!text || !registry?.length) return inferBriefNarrativeMode(brief);

  let bestId = null;
  let bestScore = 0;
  for (const mode of registry) {
    if (mode.id === NARRATIVE_AUTO || mode.behavior === "auto") continue;
    const score = scoreBriefAgainstMode(text, mode);
    if (score > bestScore) {
      bestScore = score;
      bestId = mode.id;
    }
  }
  if (bestId && bestScore > 0) return bestId;
  return inferBriefNarrativeMode(brief);
}

/** User preference from UI: auto = infer from brief, else force mode. */
export function resolveNarrativeMode(brief, preference = NARRATIVE_AUTO, registry = null) {
  const p = String(preference || NARRATIVE_AUTO).trim();
  const reg = normalizeNarrativeModeRegistry(registry);
  if (p !== NARRATIVE_AUTO) {
    if (reg) {
      const def = getModeDef(p, reg);
      if (def && def.behavior !== "auto") return p;
    } else if (KNOWN_NARRATIVE_MODES.has(p)) {
      return p;
    }
  }
  return inferFromRegistry(brief, reg);
}

export function isNonDialogueNarrativeMode(mode, registry = null) {
  const reg = normalizeNarrativeModeRegistry(registry);
  const def = getModeDef(mode, reg);
  if (def) return NON_DIALOGUE_BEHAVIORS.has(def.behavior);
  return mode === NARRATIVE_SILENT || mode === NARRATIVE_NATURE;
}

export function isSilentStylePlanMode(mode, registry = null) {
  return isNonDialogueNarrativeMode(mode, registry);
}

export function plannerAppendixForMode(mode, registry = null) {
  const reg = normalizeNarrativeModeRegistry(registry);
  const def = getModeDef(mode, reg);
  if (def?.plannerAppendix?.trim()) return def.plannerAppendix;
  if (mode === NARRATIVE_SILENT) return SILENT_PLANNER_APPENDIX;
  if (mode === NARRATIVE_NATURE) return NATURE_PLANNER_APPENDIX;
  return "";
}

export function applyPlanForMode(plan, mode, registry = null) {
  const reg = normalizeNarrativeModeRegistry(registry);
  const def = getModeDef(mode, reg);
  const behavior =
    def?.behavior ||
    (mode === NARRATIVE_SILENT
      ? "silent"
      : mode === NARRATIVE_NATURE
        ? "nature"
        : "dialogue");
  if (behavior === "silent") return applySilentObservationalPlan(plan);
  if (behavior === "nature") return applyNatureWildlifePlan(plan);
  if (behavior === "non_dialogue") return applyGenericNonDialoguePlan(plan);
  return plan;
}

export function applyGenericNonDialoguePlan(plan) {
  return {
    ...plan,
    shots: plan.shots.map((s) => {
      let action = stripEmbeddedSpeechFromAction(s.actionPrompt);
      if (!action) {
        action = String(s.scenePrompt || "")
          .replace(/^same scene,?\s+then\s+/i, "")
          .trim()
          .slice(0, 280);
      }
      if (!/no\s+(?:human\s+)?speech|mouth\s+closed|silent/i.test(action)) {
        action = `${action}. No spoken dialogue; mouths closed; ambient motion only.`.trim();
      }
      return {
        ...s,
        shotKind: "transition",
        dialogue: "",
        actionPrompt: action,
      };
    }),
  };
}

const SILENT_PATTERNS = [
  /\bnot\s+talking\b/i,
  /\bno\s+talking\b/i,
  /\bwithout\s+(?:talking|speaking|dialogue|conversation)\b/i,
  /\bno\s+dialogue\b/i,
  /\bdoesn'?t\s+talk\b/i,
  /\bnever\s+speaks?\b/i,
  /\bremains?\s+(?:completely\s+)?(?:silent|quiet|still|motionless)\b/i,
  /\b(?:silent|quiet)\s+and\s+stoic\b/i,
  /\bstoic\b/i,
  /\bquiet\b[^.]{0,80}\bwalk(?:ing)?\b/i,
  /\bjust\s+walk(?:ing)?\b/i,
  /\bwordless\b/i,
  /\bobservational\b/i,
  /\bno\s+conversation\b/i,
  /\bmouth(?:s)?\s+closed\b/i,
  /\bsilent\s+protagonist\b/i,
  /\bthings\s+happen\b[^.]{0,60}\bwalk/i,
];

const NATURE_WILDLIFE_PATTERNS = [
  /\bunderwater\b/i,
  /\bcoral(?:\s+reef|\s+movie)?\b/i,
  /\bwildlife\b/i,
  /\b(?:reef|marine)\s+life\b/i,
  /\b(?:fish|fishes)\b/i,
  /\bmacro\s+details?\b/i,
  /\bnature\s+documentary\b/i,
  /\bocean\s+documentary\b/i,
  /\bsea\s+life\b/i,
  /\b(?:octopus|jellyfish|turtle|shark|ray)\b/i,
];

const DIALOGUE_PATTERNS = [
  /\b(?:conversation|dialogue|monologue|banter|argument|debate)\b/i,
  /\b(?:says|saying|shouts|whispers|yells)\s+["']/i,
  /\btalking\s+to\b/i,
  /\boverheard\s+dialogue\b/i,
  /\b(?:scientists?|divers?)\s+(?:discuss|talk|speak|converse)\b/i,
  /\bcharacter(?:s)?\s+(?:speak|talk|say)\b/i,
];

export function inferBriefNarrativeMode(brief) {
  const text = String(brief || "").trim();
  if (!text) return NARRATIVE_DIALOGUE;

  let silent = 0;
  let nature = 0;
  let dialogue = 0;
  for (const re of SILENT_PATTERNS) if (re.test(text)) silent++;
  for (const re of NATURE_WILDLIFE_PATTERNS) if (re.test(text)) nature++;
  for (const re of DIALOGUE_PATTERNS) if (re.test(text)) dialogue++;

  if (silent >= 2) return NARRATIVE_SILENT;
  if (silent >= 1 && dialogue === 0) return NARRATIVE_SILENT;
  if (silent >= 1 && silent > dialogue) return NARRATIVE_SILENT;

  if (dialogue === 0 && nature >= 1) return NARRATIVE_NATURE;
  if (nature >= 2 && nature > dialogue) return NARRATIVE_NATURE;

  return NARRATIVE_DIALOGUE;
}

export function isSilentObservationalBrief(brief) {
  return inferBriefNarrativeMode(brief) === NARRATIVE_SILENT;
}

export function isNatureWildlifeBrief(brief) {
  return inferBriefNarrativeMode(brief) === NARRATIVE_NATURE;
}

export function isNonDialogueBrief(brief, preference = NARRATIVE_AUTO, registry = null) {
  return isNonDialogueNarrativeMode(
    resolveNarrativeMode(brief, preference, registry),
    registry
  );
}

/** Drop rules that force dialogue when the brief is silent. */
export function filterSystemRulesForNarrative(rules, mode, registry = null) {
  const active = (rules || []).map((r) => String(r).trim()).filter(Boolean);
  if (!isNonDialogueNarrativeMode(mode, registry)) return active;
  const drop = [
    /alternate\s+dialogue\s+scenes/i,
    /full\s+exchange/i,
    /several\s+lines/i,
    /dialogue\s+scenes\s+with\s+transition/i,
    /dialogue\s+belongs\s+in\s+the\s+film\s+script/i,
    /discuss\s+a\s+prop/i,
  ];
  return active.filter((r) => !drop.some((re) => re.test(r)));
}

export const SILENT_PLANNER_APPENDIX = `

SILENT / OBSERVATIONAL BRIEF (overrides default dialogue rhythm):
- The creative brief defines a NON-SPEAKING protagonist or wordless story. Honor it exactly.
- EVERY shot: shot_kind MUST be "transition". dialogue MUST be "" (empty) on every shot.
- Do NOT invent vendor/buyer/hologram dialogue, sales pitches, or conversations unless the brief explicitly asks for speech.
- action_prompt: environmental motion only — crowd activity, neon, rain, traffic, signage, passersby — while the protagonist walks/observe with mouth closed, neutral face, no lip sync. Never embed Character says "..." lines.
- Background characters may move and gesture, but the focal protagonist does not speak.
- scene_prompt: frozen still — protagonist composition from brief; static poses only.
- Vary locations and beats through the city while maintaining the same lone protagonist and look_bible.`;

export function stripEmbeddedSpeechFromAction(text) {
  let t = String(text || "").trim();
  if (!t) return "";
  t = t.replace(/\s+[A-Z][A-Za-z0-9]{0,20}\s+says\s+["'][^"']*["']/gi, "");
  t = t.replace(/\b(?:VENDOR|BUYER|SELLER|HOLOGRAM|NARRATOR)\s+says\s+["'][^"']*["']/gi, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

export const NATURE_PLANNER_APPENDIX = `

NATURE / WILDLIFE / UNDERWATER DOCUMENTARY BRIEF (overrides default dialogue rhythm):
- The brief is about animals, reef life, and environment — NOT a scripted conversation between people.
- Do NOT invent scuba divers, scientists, or narrators having dialogue (e.g. "Dr. Lena says…") unless the brief explicitly names characters who speak.
- EVERY shot: shot_kind MUST be "transition". dialogue MUST be "" on every shot.
- Subjects: realistic fish, coral, marine wildlife, water movement, macro textures, light rays, bubbles.
- action_prompt: natural motion only — schools drifting, fins, polyp sway, slow current, macro detail shifts. Never embed Character says "..." lines. No human lip sync.
- scene_prompt: photoreal frozen underwater still; static instant; name species and composition (wide reef / macro polyp / fish portrait).
- sound_prompt: underwater ambience, muffled ocean, bubbles — no music unless brief asks.
- Vary framing (wide establishing reef → macro detail → medium fish pass) while keeping look_bible consistent.`;

const SILENT_ACTION_SUFFIX =
  /(?:mouth|silent|quiet|stoic|no\s+speech|lip\s+sync)/i;
const NATURE_ACTION_SUFFIX =
  /(?:no\s+human\s+speech|natural\s+underwater|fish|reef\s+life|lip\s+sync)/i;

export function applySilentObservationalPlan(plan) {
  return {
    ...plan,
    shots: plan.shots.map((s) => {
      let action = stripEmbeddedSpeechFromAction(s.actionPrompt);
      if (!action) {
        action = String(s.scenePrompt || "")
          .replace(/^same scene,?\s+then\s+/i, "")
          .trim()
          .slice(0, 280);
      }
      if (!SILENT_ACTION_SUFFIX.test(action)) {
        action =
          `${action}. Focal protagonist mouth closed, neutral expression, completely silent, no lip sync.`.trim();
      }
      return {
        ...s,
        shotKind: "transition",
        dialogue: "",
        actionPrompt: action,
      };
    }),
  };
}

export function applyNatureWildlifePlan(plan) {
  return {
    ...plan,
    shots: plan.shots.map((s) => {
      let action = stripEmbeddedSpeechFromAction(s.actionPrompt);
      if (!action) {
        action = String(s.scenePrompt || "")
          .replace(/^same scene,?\s+then\s+/i, "")
          .trim()
          .slice(0, 280);
      }
      if (!NATURE_ACTION_SUFFIX.test(action)) {
        action =
          `${action}. Natural underwater motion only — fish and reef life drift slowly; no human speech or lip sync.`.trim();
      }
      return {
        ...s,
        shotKind: "transition",
        dialogue: "",
        actionPrompt: action,
      };
    }),
  };
}