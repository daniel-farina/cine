import { isSilentObservationalBrief } from "./briefNarrativeMode";
import { formatSystemRulesBlock } from "./systemRules";
import type { KeyframeSource, Scene, VideoSource } from "./types";
import { mergeVideoPerformancePrompt } from "./videoPerformance";

export const REFERENCE_STILL_PROMPT = "Same image, high quality.";

const SILENT_VIDEO_AUDIO =
  "No music, no score, no soundtrack, no musical sting. Natural ambient sound only.";
const SILENT_VIDEO_PERFORMANCE =
  "No dialogue, no speech, no talking; protagonist mouth closed; no lip sync.";

export function isReferenceStillPrompt(text: string): boolean {
  return /^same\s+image[,.]?\s+high\s+quality/i.test(text.trim());
}

export function isUploadLabelPrompt(text: string): boolean {
  return /^user opening still:/i.test(text.trim());
}

export type { KeyframeSource, VideoSource };

export function defaultKeyframeSource(sceneIndex: number): KeyframeSource {
  return sceneIndex > 0 ? "last_frame_hd" : "prompt";
}

export function defaultVideoSource(sceneIndex: number): VideoSource {
  return sceneIndex === 0 ? "text" : "image";
}

export function sceneVideoSource(scene: Scene, sceneIndex: number): VideoSource {
  return scene.videoSource ?? defaultVideoSource(sceneIndex);
}

export function usesTextToVideo(scene: Scene, sceneIndex: number): boolean {
  return sceneVideoSource(scene, sceneIndex) === "text";
}

export function usesOpeningUpload(scene: Scene, sceneIndex: number): boolean {
  return sceneVideoSource(scene, sceneIndex) === "upload";
}

export function usesKeyframeVideo(scene: Scene, sceneIndex: number): boolean {
  return sceneVideoSource(scene, sceneIndex) === "image";
}

export type SceneVideoPromptContext = {
  brief?: string;
  lookBible?: string;
  sceneIndex?: number;
};

/** Motion + performance prompt; skips upload filename labels; adds silent / no-music when brief requires. */
export function buildSceneVideoGenerationPrompt(
  scene: Scene,
  motionRules?: string,
  ctx?: SceneVideoPromptContext
): string {
  const silent = ctx?.brief ? isSilentObservationalBrief(ctx.brief) : false;
  const uploadOpening =
    ctx?.sceneIndex === 0 && usesOpeningUpload(scene, ctx.sceneIndex);

  let videoPrompt = scene.videoPrompt?.trim() ?? "";
  if (isUploadLabelPrompt(videoPrompt)) videoPrompt = "";

  const built = buildVideoPrompt(scene.motionPrompt, {
    videoPrompt,
    dialogue: silent ? "" : scene.dialogue,
    shotKind: silent ? "transition" : scene.shotKind,
    motionRules,
    silentObservational: silent,
  });
  if (built.trim()) return built;

  const staging =
    scene.visualBeat?.trim() ||
    (scene.imagePrompt?.trim() &&
    !isReferenceStillPrompt(scene.imagePrompt) &&
    !isUploadLabelPrompt(scene.imagePrompt)
      ? scene.imagePrompt.trim()
      : "") ||
    scene.title?.trim() ||
    "";

  let actionStaging = staging;
  if (!actionStaging && uploadOpening && ctx?.brief?.trim()) {
    actionStaging = ctx.brief.trim().slice(0, 480);
  }
  if (!actionStaging && ctx?.lookBible?.trim()) {
    actionStaging = ctx.lookBible.trim();
  }
  if (!actionStaging) return "";

  return buildVideoPrompt(scene.motionPrompt, {
    videoPrompt: actionStaging,
    dialogue: "",
    shotKind: silent ? "transition" : scene.shotKind,
    motionRules,
    silentObservational: silent,
  });
}

const DEFAULT_MOTION_RULES =
  "Gradual camera transition only; same location and subjects; no drastic change, no hard cut, no new scene.";

export function buildKeyframePrompt(
  description: string,
  opts?: {
    isContinuation?: boolean;
    lookBible?: string;
    systemRules?: string[];
  }
): string {
  let text = description.trim();
  if (opts?.isContinuation && text && !/^same scene,?\s+then\b/i.test(text)) {
    text = `Same scene, then ${text}`;
  }
  const bible = opts?.lookBible?.trim();
  if (bible && !opts?.isContinuation && text && !text.toLowerCase().includes(bible.slice(0, 20).toLowerCase())) {
    text = `${bible} ${text}`.trim();
  }
  const rulesBlock = formatSystemRulesBlock(opts?.systemRules ?? []);
  if (rulesBlock) text = text ? `${text}\n\n${rulesBlock}` : rulesBlock;
  if (!opts?.isContinuation && text.length > 0 && !isReferenceStillPrompt(text)) {
    text = `${text}\n\nFollow the described frame composition exactly: subject positions, eyelines, and depth must match this staging.`;
  }
  return text;
}

export function buildBridgeEditPrompt(systemRules: string[] = [], extraLines?: string): string {
  const parts = [
    "Upscale and restore this film frame to pristine 2K cinematic quality.",
    "Preserve exact composition, lighting, and subjects.",
    REFERENCE_STILL_PROMPT,
    "Photorealistic, natural color, subtle film grain.",
  ];
  if (extraLines?.trim()) parts.push(extraLines.trim());
  const rulesBlock = formatSystemRulesBlock(systemRules);
  if (rulesBlock) parts.push(rulesBlock);
  return parts.join(" ");
}

export function formatMotionPrompt(cameraMotion: string, motionRules?: string): string {
  const rules = motionRules?.trim() || DEFAULT_MOTION_RULES;
  const motion = cameraMotion.trim() || "Slow subtle camera move, same angle family as the keyframe";
  if (/gradual|transition|no drastic/i.test(motion)) {
    return `${motion}. ${rules}`;
  }
  return `${motion}. ${rules}`;
}

export function buildVideoPrompt(
  cameraMotion: string,
  opts?: {
    videoPrompt?: string;
    dialogue?: string;
    shotKind?: "dialogue" | "transition";
    motionRules?: string;
    silentObservational?: boolean;
  }
): string {
  const camera = formatMotionPrompt(cameraMotion, opts?.motionRules);
  const rawVideo = opts?.videoPrompt?.trim() ?? "";
  const silent = Boolean(opts?.silentObservational || opts?.shotKind === "transition");
  const performance = silent
    ? rawVideo
    : /\bsays\s+["']/i.test(rawVideo)
      ? rawVideo
      : mergeVideoPerformancePrompt(rawVideo, opts?.dialogue ?? "", opts?.shotKind);
  const parts: string[] = [];
  if (performance) parts.push(performance);
  parts.push(camera);
  if (silent) {
    parts.push("Silent beat: mouths closed, no speech, no subtitles.");
    parts.push(SILENT_VIDEO_AUDIO);
    parts.push(SILENT_VIDEO_PERFORMANCE);
  } else {
    parts.push("Lip sync and expression only — no captions, subtitles, or text burned into the frame.");
  }
  return parts.join("\n\n");
}