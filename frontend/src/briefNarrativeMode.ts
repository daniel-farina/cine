/** Match media-server/planner/briefNarrativeMode.js for client-side plan apply. */

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
];

export function inferBriefNarrativeMode(brief: string): string {
  const text = String(brief || "").trim();
  if (!text) return NARRATIVE_DIALOGUE;
  let silent = 0;
  for (const re of SILENT_PATTERNS) if (re.test(text)) silent++;
  if (silent >= 1) return NARRATIVE_SILENT;
  return NARRATIVE_DIALOGUE;
}

export function isSilentObservationalBrief(brief: string): boolean {
  return inferBriefNarrativeMode(brief) === NARRATIVE_SILENT;
}

export function stripEmbeddedSpeechFromAction(text: string): string {
  let t = String(text || "").trim();
  t = t.replace(/\s+[A-Z][A-Za-z0-9]{0,20}\s+says\s+["'][^"']*["']/gi, "");
  t = t.replace(/\b(?:VENDOR|BUYER|SELLER|HOLOGRAM|NARRATOR)\s+says\s+["'][^"']*["']/gi, "");
  return t.replace(/\s{2,}/g, " ").trim();
}