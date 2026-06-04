/** Dialogue vs silent movement beats between conversations. */

export function isTransitionShot(shot) {
  return shot?.shotKind === "transition" || shot?.shot_kind === "transition";
}

export function normalizeShotKind(kind) {
  return kind === "transition" ? "transition" : "dialogue";
}