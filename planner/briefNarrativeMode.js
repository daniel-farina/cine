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

/** User preference from UI: auto = infer from brief, else force mode. */
export function resolveNarrativeMode(brief, preference = NARRATIVE_AUTO) {
  const p = String(preference || NARRATIVE_AUTO).trim();
  if (p !== NARRATIVE_AUTO && KNOWN_NARRATIVE_MODES.has(p)) return p;
  return inferBriefNarrativeMode(brief);
}

export function isNonDialogueNarrativeMode(mode) {
  return mode === NARRATIVE_SILENT || mode === NARRATIVE_NATURE;
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

export function isNonDialogueBrief(brief, preference = NARRATIVE_AUTO) {
  return isNonDialogueNarrativeMode(resolveNarrativeMode(brief, preference));
}

/** Drop rules that force dialogue when the brief is silent. */
export function filterSystemRulesForNarrative(rules, mode) {
  const active = (rules || []).map((r) => String(r).trim()).filter(Boolean);
  if (mode !== NARRATIVE_SILENT && mode !== NARRATIVE_NATURE) return active;
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