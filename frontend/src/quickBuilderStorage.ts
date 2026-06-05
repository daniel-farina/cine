import { normalizeKeyframeSettings, normalizeVideoResolution } from "./keyframeSettings";
import type { Asset, Config, KeyframeSettings, VideoApiPayloadStored } from "./types";

const SETTINGS_KEY = "cine-quick-builder-settings";
const DRAFT_KEY = "cine-quick-builder-draft";
const PROMPTS_KEY = "cine-quick-builder-prompts";
const TIMINGS_KEY = "cine-quick-builder-timings";
const SESSION_KEY = "cine-quick-builder-session";
export const LAST_SCREEN_KEY = "cine-last-screen";

export type QuickBuilderOutputTarget = "still-only" | "still-and-video";

export type QuickClip = {
  id: string;
  label: string;
  mode: "text" | "image";
  status: "generating" | "still" | "ready" | "error";
  videoId?: string;
  keyframeId?: string;
  videoUrl?: string;
  keyframeUrl?: string;
  stillPrompt?: string;
  /** Snapshot of upload used when this image-mode clip was queued. */
  sourceKeyframeId?: string;
  sourceKeyframeUrl?: string;
  prompt: string;
  error?: string;
  apiPayload?: VideoApiPayloadStored;
  createdAt: string;
};

export type QuickBuilderSession = {
  version: 1;
  clips: QuickClip[];
  stitchOrder: string[];
  stitchedUrl: string | null;
  previewClipId: string | null;
  uploadedKeyframeId: string | null;
  status: string;
  updatedAt: string;
};

export type QuickBuilderTimings = {
  imageMs?: number;
  videoMs?: number;
  stitchMs?: number;
};

export type QuickBuilderDraft = {
  mode: "text" | "image";
  outputTarget: QuickBuilderOutputTarget;
  stillPrompt: string;
  motionPrompt: string;
};

export type PromptHistoryEntry = {
  id: string;
  mode: "text" | "image";
  stillPrompt?: string;
  motionPrompt: string;
  usedAt: string;
};

const DEFAULT_TIMINGS: Required<QuickBuilderTimings> = {
  imageMs: 45_000,
  videoMs: 120_000,
  stitchMs: 12_000,
};

const MAX_PROMPTS = 40;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function loadQuickBuilderSettings(
  studio: Partial<KeyframeSettings> | null | undefined,
  config: Config
): KeyframeSettings {
  const base = normalizeKeyframeSettings(studio, config);
  const saved = readJson<Partial<KeyframeSettings>>(SETTINGS_KEY);
  if (!saved) return base;
  return normalizeKeyframeSettings({ ...base, ...saved }, config);
}

export function saveQuickBuilderSettings(settings: KeyframeSettings) {
  writeJson(SETTINGS_KEY, {
    aspectRatio: settings.aspectRatio,
    imageResolution: settings.imageResolution,
    imageModel: settings.imageModel,
    videoDuration: settings.videoDuration,
    videoResolution: normalizeVideoResolution(settings.videoResolution),
  });
}

export function loadQuickBuilderDraft(): QuickBuilderDraft | null {
  return readJson<QuickBuilderDraft>(DRAFT_KEY);
}

export function saveQuickBuilderDraft(draft: QuickBuilderDraft) {
  writeJson(DRAFT_KEY, draft);
}

export function loadPromptHistory(): PromptHistoryEntry[] {
  const list = readJson<PromptHistoryEntry[]>(PROMPTS_KEY);
  return Array.isArray(list) ? list : [];
}

export function rememberPrompt(
  entry: Omit<PromptHistoryEntry, "id" | "usedAt">
): PromptHistoryEntry[] {
  const still = entry.stillPrompt?.trim() ?? "";
  const motion = entry.motionPrompt.trim();
  if (!motion && !still) return loadPromptHistory();

  const prev = loadPromptHistory();
  const key = `${entry.mode}|${still}|${motion}`;
  const filtered = prev.filter(
    (p) => `${p.mode}|${p.stillPrompt?.trim() ?? ""}|${p.motionPrompt.trim()}` !== key
  );
  const next: PromptHistoryEntry[] = [
    {
      id: crypto.randomUUID(),
      mode: entry.mode,
      stillPrompt: still || undefined,
      motionPrompt: motion,
      usedAt: new Date().toISOString(),
    },
    ...filtered,
  ].slice(0, MAX_PROMPTS);
  writeJson(PROMPTS_KEY, next);
  return next;
}

export function loadTimings(): QuickBuilderTimings {
  const t = readJson<QuickBuilderTimings>(TIMINGS_KEY);
  return { ...DEFAULT_TIMINGS, ...t };
}

export function estimateMs(phase: keyof QuickBuilderTimings): number {
  const t = loadTimings();
  return t[phase] ?? DEFAULT_TIMINGS[phase];
}

/** Blend last run with previous estimate so one outlier does not dominate. */
export function recordTiming(phase: keyof QuickBuilderTimings, elapsedMs: number) {
  const prev = loadTimings();
  const old = prev[phase] ?? DEFAULT_TIMINGS[phase];
  const blended = Math.round(old * 0.35 + elapsedMs * 0.65);
  const next = { ...prev, [phase]: Math.max(3000, blended) };
  writeJson(TIMINGS_KEY, next);
  return next;
}

const SESSION_VERSION = 1 as const;
const MAX_CLIPS = 48;

function sanitizeClip(clip: QuickClip): QuickClip {
  if (clip.status !== "generating") {
    if (clip.status === "ready" && !clip.videoId) {
      return { ...clip, status: "still" };
    }
    return clip;
  }
  return {
    ...clip,
    status: "error",
    error: "Interrupted — page was refreshed during generation",
  };
}

export function loadQuickBuilderSession(): QuickBuilderSession | null {
  const raw = readJson<QuickBuilderSession>(SESSION_KEY);
  if (!raw || raw.version !== SESSION_VERSION) return null;
  const clips = Array.isArray(raw.clips)
    ? raw.clips.filter((c) => c && typeof c.id === "string").map(sanitizeClip).slice(0, MAX_CLIPS)
    : [];
  const clipIds = new Set(clips.map((c) => c.id));
  const stitchOrder = Array.isArray(raw.stitchOrder)
    ? raw.stitchOrder.filter((id) => clipIds.has(id))
    : [];
  return {
    version: SESSION_VERSION,
    clips,
    stitchOrder,
    stitchedUrl: typeof raw.stitchedUrl === "string" ? raw.stitchedUrl : null,
    previewClipId:
      raw.previewClipId && clipIds.has(raw.previewClipId) ? raw.previewClipId : clips[0]?.id ?? null,
    uploadedKeyframeId:
      typeof raw.uploadedKeyframeId === "string" ? raw.uploadedKeyframeId : null,
    status: typeof raw.status === "string" ? raw.status : "",
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export function saveQuickBuilderSession(session: Omit<QuickBuilderSession, "version" | "updatedAt">) {
  const clipIds = new Set(session.clips.map((c) => c.id));
  writeJson(SESSION_KEY, {
    version: SESSION_VERSION,
    clips: session.clips.slice(0, MAX_CLIPS),
    stitchOrder: session.stitchOrder.filter((id) => clipIds.has(id)),
    stitchedUrl: session.stitchedUrl,
    previewClipId:
      session.previewClipId && clipIds.has(session.previewClipId)
        ? session.previewClipId
        : null,
    uploadedKeyframeId: session.uploadedKeyframeId,
    status: session.status,
    updatedAt: new Date().toISOString(),
  } satisfies QuickBuilderSession);
}

export function hydrateClipsFromAssets(clips: QuickClip[], assets: Asset[]): QuickClip[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  return clips.map((clip) => {
    const next = { ...clip };
    if (next.keyframeId) {
      const asset = byId.get(next.keyframeId);
      if (asset && (asset.type === "image" || asset.type === "frame")) {
        next.keyframeUrl = asset.url;
      }
    }
    if (next.videoId) {
      const asset = byId.get(next.videoId);
      if (asset?.type === "video") {
        next.videoUrl = asset.url;
        if (asset.apiPayload) next.apiPayload = asset.apiPayload;
      }
    }
    if (next.status === "ready" && next.videoId && !next.videoUrl) {
      next.status = "error";
      next.error = "Video file missing from library";
    }
    return next;
  });
}

export function resolveUploadedStill(
  assetId: string | null,
  assets: Asset[]
): { id: string; url: string } | null {
  if (!assetId) return null;
  const asset = assets.find(
    (a) => a.id === assetId && (a.type === "image" || a.type === "frame")
  );
  return asset?.url ? { id: asset.id, url: asset.url } : null;
}

export type AppScreen = "home" | "project" | "settings" | "quick";

export function loadLastScreen(): AppScreen | null {
  try {
    const s = localStorage.getItem(LAST_SCREEN_KEY);
    if (s === "home" || s === "project" || s === "settings" || s === "quick") return s;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveLastScreen(screen: AppScreen) {
  try {
    localStorage.setItem(LAST_SCREEN_KEY, screen);
  } catch {
    /* ignore */
  }
}

export function promptPreview(entry: PromptHistoryEntry): string {
  const parts: string[] = [];
  if (entry.mode === "text" && entry.stillPrompt?.trim()) {
    parts.push(entry.stillPrompt.trim().slice(0, 48));
  }
  if (entry.motionPrompt.trim()) {
    parts.push(entry.motionPrompt.trim().slice(0, 48));
  }
  const joined = parts.join(" · ");
  return joined.length > 72 ? `${joined.slice(0, 69)}…` : joined || "Prompt";
}