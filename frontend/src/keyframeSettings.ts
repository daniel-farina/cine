import type { Config, KeyframeSettings } from "./types";

/** xAI Imagine video API supports 720p (max) and 480p. */
export const DEFAULT_VIDEO_RESOLUTION = "720p";
export const VIDEO_RESOLUTIONS = ["720p", "480p"] as const;

export function normalizeVideoResolution(value?: string | null): string {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "720p" || v === "480p") return v;
  return DEFAULT_VIDEO_RESOLUTION;
}

const FALLBACK: KeyframeSettings = {
  aspectRatio: "16:9",
  imageResolution: "2k",
  imageModel: "grok-imagine-image-quality",
  videoDuration: 10,
  videoResolution: DEFAULT_VIDEO_RESOLUTION,
};

export function normalizeKeyframeSettings(
  settings?: Partial<KeyframeSettings> | null,
  config?: Config | null
): KeyframeSettings {
  const base = { ...FALLBACK, ...config?.defaults };
  return {
    aspectRatio: settings?.aspectRatio ?? base.aspectRatio ?? FALLBACK.aspectRatio,
    imageResolution: settings?.imageResolution ?? base.imageResolution ?? FALLBACK.imageResolution,
    imageModel: settings?.imageModel ?? base.imageModel ?? FALLBACK.imageModel,
    videoDuration: settings?.videoDuration ?? base.videoDuration ?? 10,
    videoResolution: normalizeVideoResolution(
      settings?.videoResolution ?? base.videoResolution ?? config?.videoResolution
    ),
  };
}