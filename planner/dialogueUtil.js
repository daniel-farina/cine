/** Fallback dialogue when the planner omits the dialogue field. */

import { isTransitionShot } from "./shotKind.js";

const STOP_NAMES = new Set([
  "Same Scene",
  "Look Bible",
  "Cybertruck",
  "Flux Capacitor",
  "Time Circuits",
  "Driver Door",
  "Interior Lights",
  "Exterior Lights",
  "Workshop Reveal",
  "Vehicle Inspection",
]);

export function toSpeakerId(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SPEAKER";
  return (parts[parts.length - 1] || parts[0]).toUpperCase().replace(/[^A-Z0-9]/g, "") || "SPEAKER";
}

export function extractCharacterNames(text) {
  const names = [];
  const seen = new Set();
  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (!name.includes(" ") || name.length < 5) continue;
    if (STOP_NAMES.has(name) || seen.has(name)) continue;
    if (/^(Same|Then|Slow|Eye|Gradual|While|When|Then)/i.test(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function lineForBeat(label, speaker, beatIndex) {
  const l = (label || "").toLowerCase();
  if (/reveal|establish|open|intro/.test(l)) {
    return `${speaker}: You have to see what I've built.`;
  }
  if (/inspect|approach|door|closer/.test(l)) {
    return `${speaker}: Tell me this thing can actually move.`;
  }
  if (/circuit|panel|time|flux|power|light|engage/.test(l)) {
    return `${speaker}: If we flip it now, there's no going back.`;
  }
  if (/drive|race|launch|exit|speed/.test(l)) {
    return `${speaker}: Hold on — we're doing this tonight.`;
  }
  const variants = [
    `${speaker}: This changes everything.`,
    `${speaker}: We don't have much time.`,
    `${speaker}: Are you sure about this?`,
  ];
  return variants[beatIndex % variants.length];
}

export function synthesizeDialogueForShot(
  scenePrompt,
  label,
  brief,
  beatIndex = 0,
  globalCast = []
) {
  const pool = [
    ...extractCharacterNames(`${brief || ""}\n${scenePrompt || ""}`),
    ...globalCast.filter((n) => !extractCharacterNames(scenePrompt || "").includes(n)),
  ].filter((n, i, a) => a.indexOf(n) === i);
  if (pool.length >= 2) {
    const a = toSpeakerId(pool[0]);
    const b = toSpeakerId(pool[1]);
    return `${lineForBeat(label, a, beatIndex)}\n${lineForBeat(label, b, beatIndex + 1)}`;
  }
  if (pool.length === 1) {
    const a = toSpeakerId(pool[0]);
    return lineForBeat(label, a, beatIndex);
  }
  return `NARRATOR: ${label || `Scene ${beatIndex + 1}`}.`;
}

export function normalizeDialogueText(dialogue) {
  let text = String(dialogue || "").trim();
  if (!text) return "";

  text = text.replace(/\bNIKOLA TESLA\b/gi, "TESLA");
  text = text.replace(/\bELON MUSK\b/gi, "ELON");

  if (!text.includes("\n")) {
    text = text.replace(/\s+(?=[A-Z][A-Z0-9]{1,20}:)/g, "\n");
  }

  const lines = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    for (const p of line.split(/\s+(?=[A-Z][A-Z0-9]{1,20}:)/)) {
      const t = p.trim();
      if (t) lines.push(t);
    }
  }
  return lines.join("\n");
}

export function countDialogueLines(dialogue) {
  return String(dialogue || "")
    .split("\n")
    .filter((l) => /^[A-Z][A-Z0-9]{1,24}:\s*.+/.test(l.trim())).length;
}

export function shotsNeedingDialogue(shots) {
  return shots.filter((s) => {
    if (isTransitionShot(s)) return false;
    const d = String(s.dialogue || "").trim();
    if (d.length < 40) return true;
    if (countDialogueLines(d) < 3) return true;
    return false;
  });
}

export function applyDialogueFallbacks(plan, brief) {
  return {
    ...plan,
    shots: plan.shots.map((s, i) => {
      if (isTransitionShot(s)) return { ...s, dialogue: "" };
      const d = String(s.dialogue || "").trim();
      if (d.length >= 8) return s;
      return {
        ...s,
        dialogue: normalizeDialogueText(
        synthesizeDialogueForShot(s.scenePrompt, s.label, brief, i)
      ),
      };
    }),
  };
}