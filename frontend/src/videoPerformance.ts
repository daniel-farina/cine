import type { Scene } from "./types";

function speakerName(label: string): string {
  const t = label.trim();
  if (!t) return "Character";
  if (t.length <= 4 && t === t.toUpperCase()) {
    return t.charAt(0) + t.slice(1).toLowerCase();
  }
  return t;
}

const MAX_SPEECH_LINES = 2;

export function dialogueToEmbeddedSpeech(dialogue: string): string {
  const lines = dialogue
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_SPEECH_LINES);
  if (!lines.length) return "";

  const parts = lines.map((line) => {
    const m = line.match(/^([A-Z][A-Z0-9]{1,24}):\s*(.+)$/);
    if (!m) return line;
    const quote = m[2].trim().replace(/"/g, "'");
    return `${speakerName(m[1])} says "${quote}"`;
  });

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} as ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} as ${parts[parts.length - 1]}`;
}

export function mergeVideoPerformancePrompt(
  videoPrompt: string,
  dialogue: string,
  shotKind?: Scene["shotKind"]
): string {
  const action = videoPrompt.trim();
  const script = dialogue.trim();

  if (shotKind === "transition") return action;
  if (action && /\bsays\s+["']/i.test(action)) return action;
  if (!script) return action;

  const speech = dialogueToEmbeddedSpeech(script);
  if (!action) return speech;
  return `${action} ${speech}`.trim();
}