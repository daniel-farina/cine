import type { AppSettings, Asset, Config, Project, ProjectsIndex } from "./types";
import type { Job, QueueSettings, QueueSummary } from "./jobTypes";
import type { PlanningMode } from "./planningModes";
import type { NarrativeModeDefinition } from "./narrativeModes";
import {
  formatPlanStreamError,
  planError,
  planLog,
  planStreamUrl,
  planWarn,
  redactPlanRequestBody,
  sanitizeFilmBrief,
  summarizePlanForLog,
} from "./planDebug";

function parseApiError(raw: unknown): string {
  if (raw == null) return "Request failed";
  if (typeof raw === "object") {
    const o = raw as { error?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.error === "string" && o.error.trim()) {
      if (typeof o.cause === "string" && o.cause.trim()) {
        return `${o.error} (${o.cause})`;
      }
      return o.error;
    }
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    return "Request failed";
  }
  if (typeof raw !== "string" || !raw.trim()) return "Request failed";
  try {
    const inner = JSON.parse(raw) as { error?: string; cause?: string };
    if (inner.cause) return `${inner.error || "Error"} (${inner.cause})`;
    return inner.error || raw;
  } catch {
    return raw;
  }
}

function httpFailureMessage(
  res: Response,
  data: Record<string, unknown>,
  text: string
): string {
  const fromBody = parseApiError(data.error);
  if (fromBody !== "Request failed") return fromBody;
  if (res.status === 413) {
    return "Image too large for upload (max 25MB file). Try a smaller JPEG or PNG.";
  }
  if (res.status === 500 && typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }
  if (res.status === 502) {
    const hint = typeof data.error === "string" ? data.error : "";
    if (/media server|Cannot reach media/i.test(hint)) {
      return hint;
    }
    return "Video service timed out or became unreachable. Refresh the page, then retry Generate video.";
  }
  if (text.trim() && !text.trim().startsWith("{")) return text.trim().slice(0, 240);
  if (res.status) return `Request failed (${res.status} ${res.statusText})`.trim();
  return "Request failed";
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw wrapFetchTimeout(e);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!res.ok) throw new Error(httpFailureMessage(res, data, text));
      throw new Error(`Invalid JSON: ${text.slice(0, 120)}`);
    }
  }
  if (!res.ok) throw new Error(httpFailureMessage(res, data, text));
  return data as T;
}

function wrapFetchTimeout(err: unknown): Error {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new Error(
      "Video generation timed out after ~29 minutes. Refresh the page and try again, or use a smaller keyframe."
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export const fetchConfig = () => json<Config>("/api/config");
export const fetchAppSettings = () => json<AppSettings>("/api/settings");
export const saveAppSettings = (settings: AppSettings) =>
  json<{ ok: boolean; settings: AppSettings }>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
export const fetchAssets = () => json<Asset[]>("/api/assets");
export const fetchProjectsIndex = () => json<ProjectsIndex>("/api/projects");
export const fetchActiveProject = () => json<Project>("/api/projects/active");
export const fetchProject = (id: string) => json<Project>(`/api/projects/${id}`);
export const createProject = (body: {
  title?: string;
  logline?: string;
  template?: "blank" | "lighthouse";
}) =>
  json<Project>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const activateProject = (id: string) =>
  json<{ activeId: string }>(`/api/projects/${id}/activate`, { method: "POST" });
export const deleteProject = (id: string) =>
  json<{ activeId: string | null }>(`/api/projects/${id}`, { method: "DELETE" });

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;

export const uploadKeyframeImage = async (
  file: File,
  body: { sceneId: string; label?: string }
) => {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new Error(
      `Image too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max 25MB — use a smaller JPEG or PNG.`
    );
  }
  const dataBase64 = await fileToBase64(file);
  return json<Asset>("/api/assets/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataBase64,
      mimeType: file.type || "image/jpeg",
      sceneId: body.sceneId,
      label: body.label,
      originalName: file.name,
    }),
  });
};

export const generateImage = (body: {
  prompt: string;
  sceneId: string;
  label?: string;
  aspect_ratio?: string;
  resolution?: string;
  model?: string;
}) =>
  json<Asset>("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const VIDEO_GENERATE_TIMEOUT_MS = 29 * 60 * 1000;

export async function generateVideo(body: {
  prompt: string;
  sourceImageId: string;
  sceneId: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}) {
  return json<Asset>("/api/videos/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(VIDEO_GENERATE_TIMEOUT_MS),
  });
}

export const extractLastFrame = (body: { videoAssetId: string; sceneId: string }) =>
  json<{ frameAsset: Asset }>("/api/videos/last-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const extractFirstFrame = (body: { videoAssetId: string; sceneId: string }) =>
  json<{ frameAsset: Asset }>("/api/videos/first-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const editImage = (body: {
  prompt: string;
  sourceAssetId: string;
  sceneId: string;
  label?: string;
  aspect_ratio?: string;
  resolution?: string;
  model?: string;
}) =>
  json<Asset>("/api/images/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const lastFrameHd = (body: {
  videoAssetId: string;
  sceneId: string;
  editPrompt?: string;
  aspect_ratio?: string;
  resolution?: string;
  model?: string;
}) =>
  json<{ frameAsset: Asset; hdAsset: Asset }>("/api/videos/last-frame-hd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const alignSceneScript = (body: {
  imagePrompt: string;
  dialogue?: string;
  title?: string;
  brief?: string;
}) =>
  json<{ imagePrompt: string; dialogue: string }>("/api/scenes/align-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const saveProject = (p: Project) =>
  json<{ ok: boolean; project: Project }>(`/api/projects/${p.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });

export type ScenePlan = {
  lookBible: string;
  storySpine?: string;
  shots: {
    label: string;
    shotKind?: string;
    scenePrompt: string;
    cameraPrompt: string;
    actionPrompt?: string;
    dialogue?: string;
    storyBeat?: string;
    continuityIn?: string;
    endState?: string;
  }[];
};

export type PlanContinuation = {
  append: boolean;
  existingCount: number;
  lookBible?: string;
  scenesSummary?: string;
  lastSceneTitle?: string;
};

export const planScenes = (body: {
  brief: string;
  shotCount: number;
  mode?: PlanningMode | string;
  aspectRatio?: string;
  systemRules?: string[];
  continuation?: PlanContinuation;
  narrativeMode?: string;
  narrativeModes?: NarrativeModeDefinition[];
  clipDurationSeconds?: number;
}) =>
  json<ScenePlan>("/api/plan/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export type PlanStreamHandlers = {
  onReasoning?: (delta: string) => void;
  onPhase?: (message: string) => void;
  onShot?: (shot: { index: number; label: string }) => void;
  onPlan?: (plan: ScenePlan) => void;
  onError?: (message: string) => void;
};

export async function planScenesStream(
  body: {
    brief: string;
    shotCount: number;
    mode?: PlanningMode | string;
    aspectRatio?: string;
    systemRules?: string[];
    continuation?: PlanContinuation;
    narrativeMode?: string;
    narrativeModes?: NarrativeModeDefinition[];
    clipDurationSeconds?: number;
  },
  handlers: PlanStreamHandlers
): Promise<ScenePlan | null> {
  const payload = {
    ...body,
    brief: sanitizeFilmBrief(body.brief),
  };
  const url = planStreamUrl();
  planLog("stream_start", { ...redactPlanRequestBody(payload), url });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = formatPlanStreamError(e);
    planError("stream_fetch_failed", { url, message: msg });
    throw new Error(msg);
  }

  if (!res.ok) {
    const text = await res.text();
    let err = res.statusText;
    try {
      const data = JSON.parse(text) as { error?: string };
      err = parseApiError(data.error) || err;
    } catch {
      if (text.trim()) err = text.slice(0, 200);
    }
    planError("stream_http_error", { status: res.status, err });
    throw new Error(err);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let plan: ScenePlan | null = null;
  let streamError: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const chunkPayload = JSON.parse(data) as Record<string, unknown>;
          if (event === "reasoning" && typeof chunkPayload.delta === "string") {
            handlers.onReasoning?.(chunkPayload.delta);
          }
          if (event === "phase" && typeof chunkPayload.message === "string") {
            handlers.onPhase?.(chunkPayload.message);
          }
          if (event === "shot" && typeof chunkPayload.label === "string") {
            handlers.onShot?.({
              index: Number(chunkPayload.index) || 0,
              label: chunkPayload.label,
            });
          }
          if (event === "plan") {
            plan = chunkPayload as ScenePlan;
            planLog("stream_plan", summarizePlanForLog(plan) ?? { empty: true });
            handlers.onPlan?.(plan);
          }
          if (event === "log") {
            planLog("server", chunkPayload);
          }
          if (event === "error") {
            const msg =
              typeof chunkPayload.message === "string"
                ? chunkPayload.message
                : "Planning failed";
            streamError = msg;
            planError("stream_error", { message: msg });
            handlers.onError?.(msg);
          }
        } catch {
          /* partial SSE chunk */
        }
      }
    }
  } catch (e) {
    if (plan) {
      planWarn("stream_read_interrupted", {
        keptPlan: true,
        error: String(e instanceof Error ? e.message : e),
      });
      return plan;
    }
    const msg = formatPlanStreamError(e);
    planError("stream_read_failed", { message: msg });
    throw new Error(msg);
  }

  if (streamError && !plan) {
    planWarn("stream_end_no_plan", { streamError });
    throw new Error(streamError);
  }
  if (!plan && !streamError) {
    const msg = formatPlanStreamError(
      new Error("Planning stream ended before a plan was received")
    );
    planWarn("stream_end_early", { bufferTail: buffer.slice(-200) });
    throw new Error(msg);
  }
  planLog("stream_end", { hasPlan: Boolean(plan), streamError });
  return plan;
}

export const stitchFilm = (body: {
  assetIds: string[];
  fade?: number;
  clipDuration: number;
}) =>
  json<Asset>("/api/stitch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const fetchJobs = () =>
  json<{ active: Job[]; recent: Job[]; summary: QueueSummary }>("/api/jobs");

export const fetchQueueConfig = () => json<QueueSettings>("/api/queue/config");

export const saveQueueConfig = (settings: QueueSettings) =>
  json<{ ok: boolean; settings: QueueSettings }>("/api/queue/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

export const enqueueJob = (body: {
  projectId: string;
  kind: string;
  payload?: Record<string, unknown>;
  label?: string;
}) =>
  json<{ ok: boolean; job: Job }>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const cancelJob = (jobId: string) =>
  json<{ ok: boolean; job: Job }>(`/api/jobs/${jobId}/cancel`, { method: "POST" });

export const resumeJob = (jobId: string) =>
  json<{ ok: boolean; job: Job }>(`/api/jobs/${jobId}/resume`, { method: "POST" });