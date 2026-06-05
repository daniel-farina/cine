import type { PlanContinuation } from "./api";

const TAG = "[cine-plan]";

export function sanitizeFilmBrief(brief: string): string {
  return String(brief || "")
    .replace(/\[Image\s*#\d+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function redactPlanRequestBody(body: {
  brief: string;
  shotCount: number;
  mode?: string;
  aspectRatio?: string;
  systemRules?: string[];
  continuation?: PlanContinuation;
  narrativeMode?: string;
  narrativeModes?: unknown[];
}) {
  const brief = sanitizeFilmBrief(body.brief);
  return {
    mode: body.mode,
    narrativeMode: body.narrativeMode,
    narrativeModeCount: body.narrativeModes?.length ?? 0,
    shotCount: body.shotCount,
    aspectRatio: body.aspectRatio,
    briefLen: brief.length,
    briefPreview: brief.slice(0, 160) + (brief.length > 160 ? "…" : ""),
    systemRulesCount: body.systemRules?.length ?? 0,
    continuation: body.continuation
      ? {
          append: body.continuation.append,
          existingCount: body.continuation.existingCount,
        }
      : undefined,
  };
}

export function summarizePlanForLog(plan: {
  lookBible?: string;
  shots?: { label?: string; scenePrompt?: string; shotKind?: string }[];
} | null) {
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

export function planLog(msg: string, data?: Record<string, unknown>) {
  if (data !== undefined) {
    console.log(TAG, msg, data);
  } else {
    console.log(TAG, msg);
  }
}

export function planWarn(msg: string, data?: Record<string, unknown>) {
  if (data !== undefined) {
    console.warn(TAG, msg, data);
  } else {
    console.warn(TAG, msg);
  }
}

/** Dev: hit API directly so Vite HMR/proxy does not cut long plan SSE streams. */
export function planStreamUrl(): string {
  if (import.meta.env.DEV) {
    const base = (import.meta.env.VITE_CINE_API_URL as string | undefined)?.replace(/\/$/, "")
      || "http://127.0.0.1:8792";
    return `${base}/api/plan/scenes/stream`;
  }
  return "/api/plan/scenes/stream";
}

export function formatPlanStreamError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes("network error") ||
    lower.includes("failed to fetch") ||
    lower.includes("incomplete chunked") ||
    lower.includes("err_connection") ||
    lower.includes("load failed")
  ) {
    return import.meta.env.DEV
      ? "Planning connection lost (often Vite hot-reload during a long run). Wait for the page to settle, avoid saving files mid-plan, then try again — or use Settings → Cinematic planner for faster runs."
      : "Planning connection lost before the server finished. Try again or use a faster planner mode.";
  }
  return raw || "Planning failed";
}

export function planError(msg: string, data?: Record<string, unknown>) {
  if (data !== undefined) {
    console.error(TAG, msg, data);
  } else {
    console.error(TAG, msg);
  }
}

/** Clear in-flight planner stubs so YOLO / Plan does not leave stuck "generating" rows. */
export function clearPlanningScenes(project: import("./types").Project): import("./types").Project {
  return {
    ...project,
    scenes: project.scenes.map((s) => {
      const hasContent = Boolean(s.visualBeat?.trim() || s.imagePrompt?.trim());
      if (s.status === "generating" && !hasContent && !s.keyframeId && !s.videoId) {
        return { ...s, status: "empty" };
      }
      return s;
    }),
  };
}