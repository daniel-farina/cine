import type { Asset, Project, Scene } from "./types";

export function isStillAsset(a: Asset): boolean {
  return a.type === "image" || a.type === "frame";
}

export type PosterPreview = { url: string; kind: "image" | "video" };

/** Home grid poster — still preferred; videos fall back to source keyframe or muted clip. */
export function resolvePosterPreview(
  posterAssetId: string | undefined,
  assets: Asset[]
): PosterPreview | null {
  if (!posterAssetId) return null;
  const asset = assets.find((a) => a.id === posterAssetId);
  if (!asset?.url) return null;

  if (isStillAsset(asset)) {
    return { url: asset.url, kind: "image" };
  }

  if (asset.type === "video") {
    const sourceId = asset.sourceImageId;
    if (sourceId) {
      const still = assets.find((a) => a.id === sourceId && isStillAsset(a));
      if (still?.url) return { url: still.url, kind: "image" };
    }
    return { url: asset.url, kind: "video" };
  }

  return null;
}

/** Latest stitched export whose source clips match the current timeline videos (in order). */
export function resolveStitchedFilmUrl(
  clipVideoIds: string[],
  assets: Asset[]
): string | null {
  if (!clipVideoIds.length) return null;
  const films = assets
    .filter((a) => a.type === "film")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const film of films) {
    const src = (film as Asset & { sourceIds?: string[] }).sourceIds;
    if (
      src?.length === clipVideoIds.length &&
      src.every((id, i) => id === clipVideoIds[i])
    ) {
      return film.url;
    }
  }
  return null;
}

export function assetFileUrl(assetId: string | undefined, assets: Asset[]): string | null {
  if (!assetId) return null;
  const a = assets.find((x) => x.id === assetId);
  if (!a) return null;
  return a.url.startsWith("http") ? a.url : a.url;
}

/** All still images (newest first). */
export function listStillAssets(assets: Asset[], sceneId?: string | null): Asset[] {
  return assets
    .filter((a) => isStillAsset(a) && (!sceneId || a.sceneId === sceneId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Newest video asset for a scene (handles regenerate). */
/** Timeline-order video asset ids (skips scenes without a clip). */
export function collectSceneVideoIds(scenes: Scene[], assets: Asset[]): string[] {
  return scenes
    .map((s) => resolveSceneVideoId(s, assets))
    .filter((id): id is string => Boolean(id));
}

export function resolveSceneVideoId(scene: Scene, assets: Asset[]): string | undefined {
  if (scene.videoId && assets.some((a) => a.id === scene.videoId && a.type === "video")) {
    return scene.videoId;
  }
  const videos = assets
    .filter((a) => a.type === "video" && a.sceneId === scene.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return videos[0]?.id;
}

/**
 * Active keyframe: explicit scene.keyframeId when that asset still exists,
 * otherwise newest still for this scene.
 */
export function resolveSceneKeyframeId(scene: Scene, assets: Asset[]): string | undefined {
  if (scene.keyframeId && assets.some((a) => a.id === scene.keyframeId && isStillAsset(a))) {
    return scene.keyframeId;
  }
  return listStillAssets(assets, scene.id)[0]?.id;
}

export function sceneTitleForAsset(
  asset: Asset,
  project: Project
): string | undefined {
  if (!asset.sceneId) return undefined;
  return project.scenes.find((s) => s.id === asset.sceneId)?.title;
}

export function assetKindLabel(asset: Asset): string {
  if (asset.source === "upload") return "Upload";
  if (asset.type === "frame") return "Extracted frame";
  if (asset.model) return "Generated";
  return asset.type === "image" ? "Image" : asset.type;
}

export function assetCaption(asset: Asset, project?: Project): string {
  const scene = project ? sceneTitleForAsset(asset, project) : undefined;
  const parts = [
    asset.label?.trim(),
    scene ? `Scene: ${scene}` : asset.sceneId ? "Other scene" : null,
    assetKindLabel(asset),
  ].filter(Boolean);
  return parts.join(" · ") || "Still";
}