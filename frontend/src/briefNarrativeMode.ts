/** Match planner/briefNarrativeMode.js for client-side plan apply. */

export const NARRATIVE_DIALOGUE = "dialogue_driven";
export const NARRATIVE_SILENT = "silent_observational";
export const NARRATIVE_NATURE = "nature_wildlife";

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

export function inferBriefNarrativeMode(brief: string): string {
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

export function isSilentObservationalBrief(brief: string): boolean {
  return inferBriefNarrativeMode(brief) === NARRATIVE_SILENT;
}

export function isNatureWildlifeBrief(brief: string): boolean {
  return inferBriefNarrativeMode(brief) === NARRATIVE_NATURE;
}

export function isNonDialogueBrief(brief: string): boolean {
  const mode = inferBriefNarrativeMode(brief);
  return mode === NARRATIVE_SILENT || mode === NARRATIVE_NATURE;
}

export function stripEmbeddedSpeechFromAction(text: string): string {
  let t = String(text || "").trim();
  t = t.replace(/\s+[A-Z][A-Za-z0-9]{0,20}\s+says\s+["'][^"']*["']/gi, "");
  t = t.replace(/\b(?:VENDOR|BUYER|SELLER|HOLOGRAM|NARRATOR|DR\.?\s*\w+)\s+says\s+["'][^"']*["']/gi, "");
  return t.replace(/\s{2,}/g, " ").trim();
}