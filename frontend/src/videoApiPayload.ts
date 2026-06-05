import type { Asset } from "./types";

export type VideoApiPayload = {
  recordedAt: string;
  client: Record<string, unknown>;
  xai: Record<string, unknown>;
  xaiStart?: Record<string, unknown>;
  note?: string;
};

export function isVideoApiPayload(v: unknown): v is VideoApiPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as VideoApiPayload;
  return Boolean(o.client && o.xai && typeof o.recordedAt === "string");
}

/** Best-effort payload for videos created before logging was added. */
export function reconstructVideoApiPayload(
  video: Asset,
  assets: Asset[]
): VideoApiPayload {
  const keyframe = video.sourceImageId
    ? assets.find((a) => a.id === video.sourceImageId)
    : undefined;
  return {
    recordedAt: video.createdAt,
    note: "Reconstructed from saved asset fields — full request body was not stored for this clip.",
    client: {
      prompt: video.prompt ?? "",
      sourceImageId: video.sourceImageId,
      sceneId: video.sceneId,
      duration: (video as Asset & { duration?: number }).duration,
      aspect_ratio: (video as Asset & { aspect_ratio?: string }).aspect_ratio,
      resolution: (video as Asset & { resolution?: string }).resolution,
    },
    xai: {
      model: video.model,
      prompt: video.prompt,
      duration: (video as Asset & { duration?: number }).duration,
      aspect_ratio: (video as Asset & { aspect_ratio?: string }).aspect_ratio,
      resolution: (video as Asset & { resolution?: string }).resolution,
      image: keyframe
        ? {
            type: "image_url",
            url: keyframe.remoteUrl ?? keyframe.url,
            keyframeAssetId: keyframe.id,
          }
        : undefined,
    },
  };
}

export function resolveVideoApiPayload(
  video: Asset | undefined,
  assets: Asset[]
): VideoApiPayload | null {
  if (!video || video.type !== "video") return null;
  const stored = (video as Asset & { apiPayload?: unknown }).apiPayload;
  if (isVideoApiPayload(stored)) return stored;
  return reconstructVideoApiPayload(video, assets);
}

export function formatPayloadJson(payload: VideoApiPayload): string {
  return JSON.stringify(payload, null, 2);
}