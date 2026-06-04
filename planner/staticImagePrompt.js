/** Frozen still only — no camera or body motion in image prompts. */

const CAMERA_CLAUSE =
  /\b(?:(?:slow|subtle|gradual)\s+[\d.%]*\s*)?(?:dolly|pan|tilt|crane|zoom|push-?in|pull-?back|tracking|handheld)\b[^.;\n]*/gi;

const MOTION_REPLACEMENTS = [
  [/\braises?\s+(his|her|their)\s+hand/gi, "with hand raised"],
  [/\braising\s+(his|her|their)\s+hand/gi, "hand raised"],
  [/\bleans?\s+in\s+(slightly\s+)?to\s+inspect/gi, "leaning in toward"],
  [/\bleans?\s+in\s+(slightly)?/gi, "leaning in"],
  [/\bsteps?\s+closer\s+to/gi, "standing close to"],
  [/\bwalks?\s+toward/gi, "standing near"],
  [/\bopens?\s+the\s+/gi, "beside the open "],
  [/\bpoints?\s+at/gi, "pointing at"],
  [/\bgestures?\s+toward/gi, "gesturing toward"],
];

export function sanitizeStillImagePrompt(prompt) {
  let t = String(prompt || "").trim();
  if (!t) return t;
  t = t.replace(CAMERA_CLAUSE, "");
  for (const [re, rep] of MOTION_REPLACEMENTS) {
    t = t.replace(re, rep);
  }
  t = t.replace(/\s+while\s+/gi, ", ");
  return t.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
}