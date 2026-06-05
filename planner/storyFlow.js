/** Story / continuity rules for ~10s image-to-video clips (research-backed). */

export const DEFAULT_CLIP_SECONDS = 10;

/** Planner instructions: one beat per clip, causal chain, minimal speech. */
export function buildClipDurationPlannerBlock(clipSeconds = DEFAULT_CLIP_SECONDS) {
  const s = Math.min(15, Math.max(4, Number(clipSeconds) || DEFAULT_CLIP_SECONDS));
  return `

CRITICAL — EACH TIMELINE CLIP IS EXACTLY ${s} SECONDS (image-to-video from one keyframe):
- One clip = ONE story beat. Never combine unrelated actions, location jumps, or time skips in a single shot.
- Plan a clear cause-and-effect chain: shot N+1 must logically follow shot N's end_state (same moment in story time unless this shot is an explicit "move" beat).
- story_spine: 1–2 sentences for the whole film (setup → complication → turn → resolution). Every shot must serve this spine.
- dialogue shots: MAX 1–2 short lines TOTAL (under 12 words per line). ${s}s clips cannot lip-sync long speeches — no monologues, no exposition dumps.
- transition shots: ONE simple motion only (walk a few steps, open door, sit, turn head, pick up prop). dialogue MUST be "".
- action_prompt: motion that completes in ~${s}s from the still — slow, continuous, no teleporting, no new characters appearing mid-clip.
- scene_prompt: frozen START pose of this beat only. end_state: frozen END pose after the ${s}s action (next shot bridges from here).
- continuity_in: what carries over from the previous clip (positions, props in hand, emotional state, location).
- story_beat: establish | continue | react | speak | move | reveal | payoff — use "establish" once at the start, "payoff" near the end.
- Avoid: random topic changes, characters discussing off-screen objects, comedy skits unrelated to the brief, multiple speakers talking over each other.
- Rhythm for ${s}s films: establish (wide) → move/react beats → sparse speak beats → payoff. Prefer more transition shots than dialogue when in doubt.`;
}

const MAX_DIALOGUE_LINES = 2;
const MAX_WORDS_PER_LINE = 14;

export function trimDialogueForClip(dialogue) {
  const lines = String(dialogue || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (out.length >= MAX_DIALOGUE_LINES) break;
    const m = line.match(/^([A-Z][A-Z0-9]{0,24}):\s*(.+)$/);
    if (m) {
      const words = m[2].trim().split(/\s+/).slice(0, MAX_WORDS_PER_LINE).join(" ");
      out.push(`${m[1]}: ${words}`);
    } else {
      const words = line.split(/\s+/).slice(0, MAX_WORDS_PER_LINE).join(" ");
      out.push(words);
    }
  }
  return out.join("\n");
}

/** Strip extra embedded "X says" clauses — one speech moment per clip. */
export function trimActionPromptForClip(action) {
  let t = String(action || "").trim();
  if (!t) return "";
  const says = [...t.matchAll(/\b[A-Za-z][A-Za-z0-9]{0,20}\s+says\s+["'][^"']*["']/gi)];
  if (says.length > 1) {
    const first = says[0][0];
    const rest = t.replace(/\b[A-Za-z][A-Za-z0-9]{0,20}\s+says\s+["'][^"']*["']/gi, "");
    t = `${first}${rest}`.replace(/\s{2,}/g, " ").trim();
  }
  if (t.length > 320) t = `${t.slice(0, 317)}…`;
  return t;
}

export function normalizePlanForClipDuration(plan, clipSeconds = DEFAULT_CLIP_SECONDS) {
  if (!plan?.shots?.length) return plan;
  const shots = plan.shots.map((s, i) => {
    const transition = s.shotKind === "transition";
    let dialogue = transition ? "" : trimDialogueForClip(s.dialogue);
    let actionPrompt = trimActionPromptForClip(s.actionPrompt);
    if (transition) {
      dialogue = "";
      if (actionPrompt && /\bsays\s+["']/i.test(actionPrompt)) {
        actionPrompt = actionPrompt.replace(/\b[A-Za-z][A-Za-z0-9]{0,20}\s+says\s+["'][^"']*["']/gi, "").trim();
      }
    }
    return {
      ...s,
      dialogue,
      actionPrompt,
      continuityIn: String(s.continuityIn || s.continuity_in || "").trim(),
      endState: String(s.endState || s.end_state || "").trim(),
      storyBeat: String(s.storyBeat || s.story_beat || "").trim(),
    };
  });
  if (!shots[0].storyBeat) shots[0].storyBeat = "establish";
  return { ...plan, shots };
}

export function formatContinuityForVideo(shot, index) {
  const parts = [];
  if (index > 0 && shot.continuityIn) parts.push(`Continues from previous clip: ${shot.continuityIn}`);
  if (shot.endState) parts.push(`This ${DEFAULT_CLIP_SECONDS}s clip ends on: ${shot.endState}`);
  if (!parts.length) return "";
  return `${parts.join(". ")}.`;
}