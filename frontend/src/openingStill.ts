import type { Config, KeyframeSettings } from "./types";

/** Best available Imagine image model + resolution for Scene 1 opening stills. */
export const OPENING_STILL_MODEL = "grok-imagine-image-quality";
export const OPENING_STILL_RESOLUTION = "2k";

export function maxQualityImageBody(
  ks: KeyframeSettings,
  config: Config
): { aspect_ratio: string; resolution: string; model: string } {
  const model =
    config.imageModels.find((m) => m.id === OPENING_STILL_MODEL)?.id ??
    config.imageModels[0]?.id ??
    OPENING_STILL_MODEL;
  const resolution = config.imageResolutions.includes(OPENING_STILL_RESOLUTION)
    ? OPENING_STILL_RESOLUTION
    : (config.imageResolutions[0] ?? OPENING_STILL_RESOLUTION);
  return {
    aspect_ratio: ks.aspectRatio,
    resolution,
    model,
  };
}