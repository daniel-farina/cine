/** Infer whether the film brief wants dialogue-driven scenes or silent/observational story. */

export const NARRATIVE_DIALOGUE = "dialogue_driven";
export const NARRATIVE_SILENT = "silent_observational";

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

const DIALOGUE_PATTERNS = [
  /\b(?:conversation|dialogue|monologue|banter|argument|debate)\b/i,
  /\b(?:says|saying|shouts|whispers|yells)\s+["']/i,
  /\btalking\s+to\b/i,
  /\boverheard\s+dialogue\b/i,
];

export function inferBriefNarrativeMode(brief) {
  const text = String(brief || "").trim();
  if (!text) return NARRATIVE_DIALOGUE;

  let silent = 0;
  let dialogue = 0;
  for (const re of SILENT_PATTERNS) if (re.test(text)) silent++;
  for (const re of DIALOGUE_PATTERNS) if (re.test(text)) dialogue++;

  if (silent >= 2) return NARRATIVE_SILENT;
  if (silent >= 1 && dialogue === 0) return NARRATIVE_SILENT;
  if (silent >= 1 && silent > dialogue) return NARRATIVE_SILENT;
  return NARRATIVE_DIALOGUE;
}

export function isSilentObservationalBrief(brief) {
  return inferBriefNarrativeMode(brief) === NARRATIVE_SILENT;
}

/** Drop rules that force dialogue when the brief is silent. */
export function filterSystemRulesForNarrative(rules, mode) {
  const active = (rules || []).map((r) => String(r).trim()).filter(Boolean);
  if (mode !== NARRATIVE_SILENT) return active;
  const drop = [
    /alternate\s+dialogue\s+scenes/i,
    /full\s+exchange/i,
    /several\s+lines/i,
    /dialogue\s+scenes\s+with\s+transition/i,
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
      if (!/\b(?:mouth|silent|quiet|stoic|no\s+speech|lip\s+sync)\b/i.test(action)) {
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