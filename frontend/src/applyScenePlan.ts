import {
  buildKeyframePrompt,
  defaultKeyframeSource,
  REFERENCE_STILL_PROMPT,
} from "./prompts";
import {
  isNonDialogueBrief,
  isNatureWildlifeBrief,
  stripEmbeddedSpeechFromAction,
} from "./briefNarrativeMode";
import { mergeVideoPerformancePrompt } from "./videoPerformance";
import type { ScenePlan } from "./api";
import type { Project, Scene } from "./types";

export type TimelineApplyMode = "replace" | "append";

/** Default empty Scene 1 from blank projects — not part of an AI plan. */
export function isStubScene(s: Scene): boolean {
  return (
    !s.keyframeId &&
    !s.videoId &&
    !(s.visualBeat?.trim() || s.imagePrompt?.trim()) &&
    s.status === "empty"
  );
}

/** Scenes that count when appending (drops leading empty placeholders). */
export function scenesToKeepForAppend(existingScenes: Scene[]): Scene[] {
  return existingScenes.filter((s) => !isStubScene(s));
}

/** Scene 1 with only a user upload — not an AI-planned shot yet. */
export function isUploadOnlyScene(s: Scene): boolean {
  if (s.shotKind) return false;
  if (s.visualBeat?.trim()) return false;
  if (s.videoPrompt?.trim()) return false;
  const ip = (s.imagePrompt ?? "").trim();
  if (/^user opening still:/i.test(ip) && !s.videoPrompt?.trim()) return true;
  return s.videoSource === "upload" && Boolean(s.keyframeId);
}

/** YOLO should run the planner when the timeline is empty, upload-only, or shorter than the scene count. */
export function yoloNeedsPlan(p: Project, targetSceneCount: number): boolean {
  if (p.scenes.length === 0) return true;
  const real = p.scenes.filter((s) => !isStubScene(s));
  if (real.length === 0) return true;
  if (real.length < targetSceneCount) return true;
  if (real.every((s) => isUploadOnlyScene(s))) return true;
  const hasPlannedShot = real.some(
    (s) => Boolean(s.videoPrompt?.trim() || s.visualBeat?.trim() || s.shotKind)
  );
  return !hasPlannedShot;
}

export type SavedOpeningUpload = {
  keyframeId: string;
};

export function readOpeningUpload(scenes: Scene[]): SavedOpeningUpload | null {
  const s = scenes[0];
  if (!s?.keyframeId || s.videoSource !== "upload") return null;
  return { keyframeId: s.keyframeId };
}

/** Re-attach Scene 1 opening upload after replace-plan (keeps planner prompts on the scene). */
export function attachOpeningUploadToScene1(
  project: Project,
  saved: SavedOpeningUpload
): Project {
  const scene = project.scenes[0];
  if (!scene) return project;
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id === scene.id
        ? {
            ...s,
            keyframeId: saved.keyframeId,
            keyframeSource: "upload",
            videoSource: "upload",
            status: "keyframe",
            error: undefined,
          }
        : s
    ),
    selectedSceneId: scene.id,
  };
}

const REF_STILL = REFERENCE_STILL_PROMPT;
const TRANSITION_MOTION =
  "Silent physical action only — gradual camera move, same location family, mouths closed.";

function usesReferenceLayout(globalIndex: number, appendHadScenes: boolean, shotIndex: number): boolean {
  return globalIndex > 0 || (appendHadScenes && shotIndex === 0);
}

function sceneFromShot(
  shot: ScenePlan["shots"][0],
  globalIndex: number,
  appendHadScenes: boolean,
  shotIndex: number,
  lookBible: string,
  brief: string
): Scene {
  const nonDialogue = isNonDialogueBrief(brief);
  const natureStory = isNatureWildlifeBrief(brief);
  const transition = nonDialogue || shot.shotKind === "transition";
  const reference = usesReferenceLayout(globalIndex, appendHadScenes, shotIndex);
  let beat = shot.scenePrompt.trim();
  const dialogue = transition ? "" : (shot.dialogue ?? "").trim();
  let videoPrompt = stripEmbeddedSpeechFromAction((shot.actionPrompt ?? "").trim());
  if (natureStory && videoPrompt && !/\b(?:fish|reef|underwater|no\s+human|lip\s+sync)\b/i.test(videoPrompt)) {
    videoPrompt =
      `${videoPrompt}. Natural underwater motion — fish and reef life only; no human speech or lip sync.`.trim();
  } else if (nonDialogue && !natureStory && videoPrompt && !/\b(?:mouth|silent|no\s+speech|lip\s+sync)\b/i.test(videoPrompt)) {
    videoPrompt =
      `${videoPrompt}. Focal protagonist mouth closed, neutral expression, completely silent, no lip sync.`.trim();
  }
  let imagePrompt = beat;

  if (reference) {
    beat = buildKeyframePrompt(beat, { isContinuation: true, lookBible });
    imagePrompt = REF_STILL;
    if (!videoPrompt && transition) {
      videoPrompt = beat.replace(/^same scene,?\s+then\s+/i, "").trim();
    }
  } else if (lookBible && !beat.toLowerCase().includes(lookBible.slice(0, 20).toLowerCase())) {
    imagePrompt = `${lookBible.trim()} ${beat}`.trim();
  }

  if (!nonDialogue && !transition && dialogue) {
    videoPrompt = mergeVideoPerformancePrompt(videoPrompt, dialogue, "dialogue");
  }

  return {
    id: crypto.randomUUID(),
    title: shot.label || `Scene ${globalIndex + 1}`,
    shotKind: transition ? "transition" : "dialogue",
    imagePrompt,
    visualBeat: reference ? beat : undefined,
    videoPrompt,
    dialogue,
    motionPrompt:
      shot.cameraPrompt.trim() ||
      (transition ? TRANSITION_MOTION : "Slow subtle dolly in, eye level, 35mm"),
    keyframeSource: defaultKeyframeSource(globalIndex),
    status: "empty",
  };
}

export function scenesFromPlan(
  plan: ScenePlan,
  mode: TimelineApplyMode,
  existingScenes: Scene[],
  brief = ""
): Scene[] {
  const kept = mode === "append" ? scenesToKeepForAppend(existingScenes) : [];
  const hadScenes = kept.length > 0;
  const baseIndex = mode === "append" ? kept.length : 0;
  const lookBible = plan.lookBible?.trim() || "";

  const built = plan.shots.map((shot, i) =>
    sceneFromShot(shot, baseIndex + i, hadScenes, i, lookBible, brief)
  );

  return mode === "append" ? [...kept, ...built] : built;
}

export function projectWithPlan(
  project: Project,
  plan: ScenePlan,
  mode: TimelineApplyMode,
  brief: string
): Project {
  const keptBefore =
    mode === "append" ? scenesToKeepForAppend(project.scenes) : [];
  const scenes = scenesFromPlan(plan, mode, project.scenes, brief);
  const firstNew =
    mode === "append" ? scenes[keptBefore.length] : scenes[0];

  return {
    ...project,
    lookBible: plan.lookBible?.trim() || project.lookBible,
    logline: brief.trim() || project.logline,
    scenes,
    selectedSceneId: firstNew?.id ?? scenes[0]?.id ?? project.selectedSceneId,
  };
}

export function buildPlanContinuation(project: Project): {
  append: true;
  existingCount: number;
  lookBible?: string;
  scenesSummary: string;
  lastSceneTitle?: string;
} {
  const kept = scenesToKeepForAppend(project.scenes);
  const scenes = kept.map((s) => ({
    title: s.title,
    shotKind: s.shotKind,
    visualBeat: s.visualBeat,
    imagePrompt: s.imagePrompt,
    dialogue: s.dialogue,
    videoPrompt: s.videoPrompt,
    motionPrompt: s.motionPrompt,
  }));

  const tail = scenes.slice(-5);
  const blocks = tail.map((s, i) => {
    const n = scenes.length - tail.length + i + 1;
    const lines = [`Scene ${n} — ${s.title}`];
    if (s.shotKind) lines.push(`Type: ${s.shotKind}`);
    const beat = (s.visualBeat || s.imagePrompt || "").trim();
    if (beat && !/^same image/i.test(beat)) lines.push(`Staging: ${beat.slice(0, 300)}`);
    if (s.dialogue?.trim()) lines.push(`Dialogue: ${s.dialogue.trim().slice(0, 200)}`);
    if (s.videoPrompt?.trim()) lines.push(`Action: ${s.videoPrompt.trim().slice(0, 160)}`);
    return lines.join("\n");
  });

  let summary = blocks.join("\n\n");
  if (scenes.length > tail.length) {
    summary = `(${scenes.length - tail.length} earlier scenes omitted)\n\n${summary}`;
  }

  return {
    append: true,
    existingCount: kept.length,
    lookBible: project.lookBible,
    scenesSummary: summary,
    lastSceneTitle: kept[kept.length - 1]?.title,
  };
}