/** Per-project / studio rules appended to keyframe, bridge, and planner prompts. */

export function normalizeSystemRules(rules?: string[]): string[] {
  if (!rules?.length) return [];
  return rules.map((r) => (typeof r === "string" ? r : ""));
}

/** Legacy name — no longer injects built-in defaults. */
export function mergeMissingDefaultRules(rules: string[]): string[] {
  return normalizeSystemRules(rules);
}

export function rulesForPrompt(rules: string[]): string[] {
  return rules.map((r) => r.trim()).filter(Boolean);
}

export function formatSystemRulesBlock(rules: string[]): string {
  const active = rulesForPrompt(rules);
  if (!active.length) return "";
  return `Generation constraints:\n${active.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}