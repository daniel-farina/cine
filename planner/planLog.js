/** Structured planner logs — stderr for PM2 + optional SSE `log` events. */

import { inferBriefNarrativeMode } from "./briefNarrativeMode.js";

export function createPlanLogger(send) {
  const log = (level, msg, data = {}) => {
    const entry = {
      t: new Date().toISOString(),
      level,
      msg,
      ...data,
    };
    process.stderr.write(`[cine-plan] ${JSON.stringify(entry)}\n`);
    send?.("log", entry);
  };

  return {
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
    debug: (msg, data) => log("debug", msg, data),
  };
}

export function redactPlanRequest(body) {
  if (!body || typeof body !== "object") return body;
  const brief = String(body.brief || "");
  return {
    mode: body.mode,
    shotCount: body.shotCount,
    aspectRatio: body.aspectRatio,
    briefLen: brief.length,
    briefPreview: brief.slice(0, 160) + (brief.length > 160 ? "…" : ""),
    narrativeMode: inferBriefNarrativeMode(brief),
    systemRulesCount: Array.isArray(body.systemRules) ? body.systemRules.length : 0,
    continuation: body.continuation
      ? {
          append: body.continuation.append,
          existingCount: body.continuation.existingCount,
        }
      : undefined,
  };
}

export function summarizePlan(plan) {
  if (!plan) return null;
  return {
    lookBibleLen: plan.lookBible?.length ?? 0,
    shotCount: plan.shots?.length ?? 0,
    shots: (plan.shots || []).map((s, i) => ({
      i,
      label: s.label,
      kind: s.shotKind,
      scenePromptLen: s.scenePrompt?.length ?? 0,
    })),
  };
}