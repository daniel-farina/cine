import {
  editImage,
  extractFirstFrame,
  extractLastFrame,
  generateImage,
  generateVideo,
  lastFrameHd,
} from "./api";
import type { EffectiveSettings } from "./effectiveSettings";
import { maxQualityImageBody } from "./openingStill";
import {
  buildBridgeEditPrompt,
  buildKeyframePrompt,
  buildSceneVideoGenerationPrompt,
  defaultKeyframeSource,
  REFERENCE_STILL_PROMPT,
  usesOpeningUpload,
  usesTextToVideo,
} from "./prompts";
import { resolveSceneKeyframeId, resolveSceneVideoId } from "./sceneAssets";
import type { ProgressPatch, StepKind, StepStatus } from "./createAllTypes";
import type { Asset, Config, Project, Scene } from "./types";

const REF_STILL = REFERENCE_STILL_PROMPT;

function updateScene(scenes: Scene[], id: string, patch: Partial<Scene>): Scene[] {
  return scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export class CreateAllCancelled extends Error {
  override name = "CreateAllCancelled";
}

export type CreateAllDeps = {
  getProject: () => Project | null;
  getAssets: () => Asset[];
  getConfig: () => Config;
  getEffective: () => EffectiveSettings;
  persistProject: (updater: (p: Project) => Project) => Promise<void>;
  refreshAssets: () => Promise<Asset[]>;
  onProgress: (patch: ProgressPatch) => void;
  shouldAbort?: () => boolean;
};

function throwIfAborted(deps: CreateAllDeps): void {
  if (deps.shouldAbort?.()) throw new CreateAllCancelled();
}

function setStep(
  onProgress: CreateAllDeps["onProgress"],
  sceneId: string,
  step: StepKind,
  stepStatus: StepStatus,
  extra?: ProgressPatch
) {
  onProgress({ sceneId, step, stepStatus, ...extra });
}

async function runKeyframeForScene(
  deps: CreateAllDeps,
  sceneIndex: number,
  scene: Scene,
  prevScene: Scene | null,
  assets: Asset[],
  project: Project
): Promise<void> {
  const { persistProject, getEffective, getConfig } = deps;
  const effective = getEffective();
  const config = getConfig();
  const ks = effective.keyframeSettings;
  const openingFromPrompts = sceneIndex === 0 && usesTextToVideo(scene, sceneIndex);
  const imageBody = openingFromPrompts
    ? maxQualityImageBody(ks, config)
    : {
        aspect_ratio: ks.aspectRatio,
        resolution: ks.imageResolution,
        model: ks.imageModel,
      };
  const rules = effective.systemRules;
  const bridgeEdit = buildBridgeEditPrompt(rules, effective.bridgeEditPrompt);

  const source =
    scene.keyframeSource ?? defaultKeyframeSource(sceneIndex);
  const prevVideoId = prevScene ? resolveSceneVideoId(prevScene, assets) : undefined;
  const prevKeyframeId = prevScene ? resolveSceneKeyframeId(prevScene, assets) : undefined;
  const ownVideoId = resolveSceneVideoId(scene, assets);
  const ownKeyframeId = resolveSceneKeyframeId(scene, assets);

  const patchKeyframe = (patch: Partial<Scene>) =>
    persistProject((p) => ({
      ...p,
      scenes: updateScene(p.scenes, scene.id, {
        ...patch,
        status: "keyframe",
        error: undefined,
      }),
    }));

  if (source === "prompt") {
    const text =
      scene.visualBeat?.trim() ||
      scene.imagePrompt?.trim() ||
      scene.title;
    if (!text) throw new Error(`${scene.title}: missing image prompt.`);
    throwIfAborted(deps);
    const asset = await generateImage({
      prompt: buildKeyframePrompt(text, {
        isContinuation: sceneIndex > 0,
        lookBible: project.lookBible,
        systemRules: rules,
      }),
      sceneId: scene.id,
      label: scene.title,
      ...imageBody,
    });
    await patchKeyframe({
      keyframeId: asset.id,
      bridgedFromSceneId: undefined,
      imagePrompt: scene.imagePrompt || text,
    });
    return;
  }

  if (source === "reuse_prev_keyframe" && prevKeyframeId && prevScene) {
    await patchKeyframe({
      keyframeId: prevKeyframeId,
      bridgedFromSceneId: prevScene.id,
      imagePrompt: REF_STILL,
    });
    return;
  }

  if (source === "first_frame_prev" && prevVideoId && prevScene) {
    throwIfAborted(deps);
    const { frameAsset } = await extractFirstFrame({
      videoAssetId: prevVideoId,
      sceneId: scene.id,
    });
    await patchKeyframe({
      keyframeId: frameAsset.id,
      bridgedFromSceneId: prevScene.id,
      imagePrompt: REF_STILL,
    });
    return;
  }

  if (source === "last_frame" && prevVideoId && prevScene) {
    throwIfAborted(deps);
    const { frameAsset } = await extractLastFrame({
      videoAssetId: prevVideoId,
      sceneId: scene.id,
    });
    await patchKeyframe({
      keyframeId: frameAsset.id,
      bridgedFromSceneId: prevScene.id,
      imagePrompt: REF_STILL,
    });
    return;
  }

  if (source === "self_last_frame" && ownVideoId) {
    throwIfAborted(deps);
    const { frameAsset } = await extractLastFrame({
      videoAssetId: ownVideoId,
      sceneId: scene.id,
    });
    await patchKeyframe({
      keyframeId: frameAsset.id,
      bridgedFromSceneId: undefined,
      imagePrompt: REF_STILL,
    });
    return;
  }

  if (source === "self_last_frame_hd" && ownVideoId) {
    throwIfAborted(deps);
    const { hdAsset } = await lastFrameHd({
      videoAssetId: ownVideoId,
      sceneId: scene.id,
      editPrompt: bridgeEdit,
      ...imageBody,
    });
    await patchKeyframe({
      keyframeId: hdAsset.id,
      imagePrompt: REF_STILL,
    });
    return;
  }

  if (source === "edit_existing" && ownKeyframeId) {
    throwIfAborted(deps);
    const asset = await editImage({
      prompt:
        buildKeyframePrompt(scene.imagePrompt || scene.visualBeat || "", {
          isContinuation: sceneIndex > 0,
          lookBible: project.lookBible,
          systemRules: rules,
        }) || "Enhance to 2K cinematic quality, preserve composition exactly",
      sourceAssetId: ownKeyframeId,
      sceneId: scene.id,
      label: scene.title,
      ...imageBody,
    });
    await patchKeyframe({ keyframeId: asset.id });
    return;
  }

  if (source === "hd_existing" && ownKeyframeId) {
    throwIfAborted(deps);
    const asset = await editImage({
      prompt: bridgeEdit,
      sourceAssetId: ownKeyframeId,
      sceneId: scene.id,
      label: `${scene.title} HD`,
      ...imageBody,
    });
    await patchKeyframe({ keyframeId: asset.id, imagePrompt: REF_STILL });
    return;
  }

  if (prevVideoId && prevScene) {
    throwIfAborted(deps);
    const { hdAsset } = await lastFrameHd({
      videoAssetId: prevVideoId,
      sceneId: scene.id,
      editPrompt: bridgeEdit,
      ...imageBody,
    });
    await patchKeyframe({
      keyframeId: hdAsset.id,
      bridgedFromSceneId: prevScene.id,
      imagePrompt: REF_STILL,
    });
    return;
  }

  if (sceneIndex === 0) {
    const text = scene.imagePrompt?.trim() || scene.visualBeat?.trim();
    if (!text) throw new Error(`${scene.title}: add an image prompt or run the planner first.`);
    throwIfAborted(deps);
    const asset = await generateImage({
      prompt: buildKeyframePrompt(text, {
        isContinuation: false,
        lookBible: project.lookBible,
        systemRules: rules,
      }),
      sceneId: scene.id,
      label: scene.title,
      ...imageBody,
    });
    await patchKeyframe({ keyframeId: asset.id, imagePrompt: text });
    return;
  }

  throw new Error(
    `${scene.title}: cannot auto-keyframe (method: ${source}). Finish the previous scene’s video or set a text prompt.`
  );
}

async function ensureKeyframe(
  deps: CreateAllDeps,
  sceneIndex: number,
  scene: Scene,
  prevScene: Scene | null,
  assets: Asset[]
): Promise<void> {
  const { onProgress, refreshAssets, getProject } = deps;
  const project = getProject();
  if (!project) return;

  if (usesOpeningUpload(scene, sceneIndex)) {
    if (resolveSceneKeyframeId(scene, assets)) {
      setStep(onProgress, scene.id, "keyframe", "done", {
        label: `${scene.title} · opening still uploaded`,
      });
      return;
    }
    throw new Error(
      `${scene.title}: upload an opening still before YOLO (Video tab → Upload opening still).`
    );
  }

  if (resolveSceneKeyframeId(scene, assets)) {
    setStep(onProgress, scene.id, "keyframe", "done", {
      label: `${scene.title} · keyframe ready`,
    });
    return;
  }

  const textFirst = usesTextToVideo(scene, sceneIndex);
  setStep(onProgress, scene.id, "keyframe", "running", {
    currentStep: "keyframe",
    label: textFirst
      ? `${scene.title} · opening still from prompts…`
      : `${scene.title} · keyframe…`,
  });

  await runKeyframeForScene(deps, sceneIndex, scene, prevScene, assets, project);
  await refreshAssets();
  setStep(onProgress, scene.id, "keyframe", "done");
}

async function ensureVideo(
  deps: CreateAllDeps,
  sceneIndex: number,
  scene: Scene,
  assets: Asset[]
): Promise<void> {
  const { persistProject, onProgress, refreshAssets, getProject, getEffective, getConfig } =
    deps;
  const effective = getEffective();
  const config = getConfig();
  const ks = effective.keyframeSettings;

  if (resolveSceneVideoId(scene, assets)) {
    setStep(onProgress, scene.id, "video", "done", {
      label: `${scene.title} · video ready`,
    });
    return;
  }

  let fresh = getProject()?.scenes.find((s) => s.id === scene.id) ?? scene;
  let keyframeId = resolveSceneKeyframeId(fresh, assets);
  const project = getProject();
  if (!keyframeId && sceneIndex === 0 && usesTextToVideo(fresh, sceneIndex) && project) {
    setStep(onProgress, fresh.id, "keyframe", "running", {
      label: `${fresh.title} · opening still (max quality)…`,
    });
    const prev = sceneIndex > 0 ? project.scenes[sceneIndex - 1] : null;
    await runKeyframeForScene(deps, sceneIndex, fresh, prev, assets, project);
    assets = await refreshAssets();
    fresh = getProject()?.scenes.find((s) => s.id === scene.id) ?? fresh;
    keyframeId = resolveSceneKeyframeId(fresh, assets);
  }
  if (!keyframeId) {
    throw new Error(`${fresh.title}: keyframe missing before video.`);
  }

  const prompt = buildSceneVideoGenerationPrompt(fresh, effective.motionRules, {
    brief: project?.logline?.trim() || project?.title,
    lookBible: project?.lookBible,
    sceneIndex,
  });
  if (!prompt.trim()) {
    throw new Error(`${fresh.title}: missing video prompt for generation.`);
  }

  setStep(onProgress, scene.id, "video", "running", {
    currentStep: "video",
    label: `${fresh.title} · video…`,
  });

  throwIfAborted(deps);
  const asset = await generateVideo({
    prompt,
    sourceImageId: keyframeId,
    sceneId: fresh.id,
    duration: ks.videoDuration ?? config.defaults.videoDuration,
    aspect_ratio: ks.aspectRatio,
    resolution: ks.videoResolution,
  });
  throwIfAborted(deps);

  await persistProject((p) => ({
    ...p,
    scenes: updateScene(p.scenes, fresh.id, {
      videoId: asset.id,
      status: "video",
      error: undefined,
    }),
  }));
  await refreshAssets();
  setStep(onProgress, scene.id, "video", "done");
}

async function ensureBridgeToNext(
  deps: CreateAllDeps,
  scene: Scene,
  nextScene: Scene,
  assets: Asset[]
): Promise<void> {
  const { persistProject, onProgress, refreshAssets, getProject, getEffective } = deps;
  const effective = getEffective();
  const ks = effective.keyframeSettings;
  const imageBody = {
    aspect_ratio: ks.aspectRatio,
    resolution: ks.imageResolution,
    model: ks.imageModel,
  };

  const nextFresh = getProject()?.scenes.find((s) => s.id === nextScene.id) ?? nextScene;
  if (
    nextFresh.bridgedFromSceneId === scene.id &&
    resolveSceneKeyframeId(nextFresh, assets)
  ) {
    setStep(onProgress, scene.id, "bridge", "done", {
      label: `${scene.title} · bridge ready`,
    });
    return;
  }

  const sourceVideoId = resolveSceneVideoId(scene, assets);
  if (!sourceVideoId) {
    throw new Error(`${scene.title}: video required before bridge.`);
  }

  setStep(onProgress, scene.id, "bridge", "running", {
    currentStep: "bridge",
    label: `${scene.title} → ${nextFresh.title} · bridge…`,
  });

  throwIfAborted(deps);
  const { hdAsset } = await lastFrameHd({
    videoAssetId: sourceVideoId,
    sceneId: nextScene.id,
    editPrompt: buildBridgeEditPrompt(
      effective.systemRules,
      effective.bridgeEditPrompt
    ),
    ...imageBody,
  });
  throwIfAborted(deps);

  await persistProject((p) => ({
    ...p,
    scenes: updateScene(p.scenes, nextScene.id, {
      keyframeId: hdAsset.id,
      bridgedFromSceneId: scene.id,
      keyframeSource: nextFresh.keyframeSource ?? defaultKeyframeSource(
        p.scenes.findIndex((s) => s.id === nextScene.id)
      ),
      imagePrompt: REF_STILL,
      status: "keyframe",
      error: undefined,
    }),
  }));
  await refreshAssets();
  setStep(onProgress, scene.id, "bridge", "done");
}

export async function runCreateAllPipeline(deps: CreateAllDeps): Promise<void> {
  const project = deps.getProject();
  if (!project?.scenes.length) {
    throw new Error("Add scenes to the timeline first.");
  }

  const scenes = project.scenes;
  let assets = deps.getAssets();
  const unplannable = scenes.filter((s, i) => {
    if (i !== 0) return false;
    if (resolveSceneKeyframeId(s, assets)) return false;
    if (usesOpeningUpload(s, i)) return false;
    const hasStillPrompt = Boolean(s.visualBeat?.trim() || s.imagePrompt?.trim());
    const hasVideoPrompt = Boolean(
      buildSceneVideoGenerationPrompt(s, deps.getEffective().motionRules, {
        brief: project.logline?.trim() || project.title,
        lookBible: project.lookBible,
        sceneIndex: project.scenes.findIndex((x) => x.id === s.id),
      }).trim()
    );
    return !hasStillPrompt && !hasVideoPrompt;
  });
  if (unplannable.length) {
    throw new Error(
      "Scene 1 needs a prompt (run YOLO with a film brief to plan scenes first)."
    );
  }
  const stepCount = scenes.reduce((n, _, i) => {
    let c = 2;
    if (i < scenes.length - 1) c += 1;
    return n + c;
  }, 0);
  let completedSteps = 0;

  for (let i = 0; i < scenes.length; i++) {
    throwIfAborted(deps);
    const proj = deps.getProject() ?? project;
    const scene = proj.scenes[i] ?? scenes[i];
    const prev = i > 0 ? proj.scenes[i - 1] ?? scenes[i - 1] : null;
    const next = i < scenes.length - 1 ? proj.scenes[i + 1] : null;

    deps.onProgress({ sceneIndex: i, label: scene.title, phase: "generate" });

    assets = await deps.refreshAssets();

    try {
      await ensureKeyframe(deps, i, scene, prev, assets);
      completedSteps += 1;
    } catch (e) {
      setStep(deps.onProgress, scene.id, "keyframe", "error");
      throw e;
    }
    assets = await deps.refreshAssets();

    try {
      const mid = deps.getProject()?.scenes[i] ?? scene;
      await ensureVideo(deps, i, mid, assets);
      completedSteps += 1;
    } catch (e) {
      setStep(deps.onProgress, scene.id, "video", "error");
      throw e;
    }
    assets = await deps.refreshAssets();

    if (next) {
      try {
        const mid = deps.getProject()?.scenes[i] ?? scene;
        await ensureBridgeToNext(deps, mid, next, assets);
        completedSteps += 1;
      } catch (e) {
        setStep(deps.onProgress, scene.id, "bridge", "error");
        throw e;
      }
      assets = await deps.refreshAssets();
    } else {
      setStep(deps.onProgress, scene.id, "bridge", "skipped");
    }

    deps.onProgress({
      overall: Math.min(1, completedSteps / stepCount),
      phase: "generate",
    });
  }

  deps.onProgress({
    overall: 1,
    label: "YOLO finished — timeline complete",
    currentStep: null,
    phase: "idle",
  });
}