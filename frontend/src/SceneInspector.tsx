import { useEffect, useMemo, useRef, useState } from "react";
import {
  alignSceneScript,
  editImage,
  extractFirstFrame,
  extractLastFrame,
  generateImage,
  generateVideo,
  lastFrameHd,
  uploadKeyframeImage,
} from "./api";
import ImageUploadZone, { type ImageUploadZoneHandle } from "./ImageUploadZone";
import KeyframeMethodPicker from "./KeyframeMethodPicker";
import {
  canRunKeyframeAction,
  keyframeActionLabel,
  keyframeMethodGroup,
  usesReferenceWorkflow,
  type KeyframeMethodContext,
} from "./keyframeMethods";
import {
  buildBridgeEditPrompt,
  buildKeyframePrompt,
  buildSceneVideoGenerationPrompt,
  defaultKeyframeSource,
  defaultVideoSource,
  REFERENCE_STILL_PROMPT,
  sceneVideoSource,
  usesOpeningUpload,
  usesTextToVideo,
  type KeyframeSource,
  type VideoSource,
} from "./prompts";
import { maxQualityImageBody } from "./openingStill";
import VideoSourcePicker from "./VideoSourcePicker";
import ImageGallery from "./ImageGallery";
import {
  assetFileUrl,
  listStillAssets,
  resolveSceneKeyframeId,
  resolveSceneVideoId,
} from "./sceneAssets";
import type { Asset as AssetType } from "./types";
import type { Asset, Config, KeyframeSettings, Project, Scene } from "./types";

const REF_STILL = REFERENCE_STILL_PROMPT;

type Props = {
  project: Project;
  config: Config;
  scene: Scene;
  sceneIndex: number;
  assets: Asset[];
  ks: KeyframeSettings;
  busy: boolean;
  setBusy: (v: boolean) => void;
  status: string;
  setStatus: (s: string) => void;
  onPersist: (p: Project) => Promise<void>;
  onReloadAssets: () => Promise<Asset[]>;
  systemRules: string[];
  bridgeEditPrompt?: string;
  motionRules?: string;
};

function updateScene(scenes: Scene[], id: string, patch: Partial<Scene>): Scene[] {
  return scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

type InspectorTab = "keyframe" | "video" | "bridge";

function defaultInspectorTab(scene: Scene, sceneIndex: number): InspectorTab {
  const opening = sceneVideoSource(scene, sceneIndex);
  if (sceneIndex === 0 && (opening === "text" || opening === "upload") && !scene.videoId) {
    return "video";
  }
  if (!scene.keyframeId) return "keyframe";
  if (!scene.videoId) return "video";
  return "bridge";
}

const KEYFRAME_TAB_GROUPS = ["generate", "import", "refine"] as const;
const BRIDGE_TAB_GROUPS = ["previous"] as const;
const VIDEO_TAB_GROUPS = ["this_clip"] as const;

export default function SceneInspector({
  project,
  config,
  scene,
  sceneIndex,
  assets,
  ks,
  busy,
  setBusy,
  status,
  setStatus,
  onPersist,
  onReloadAssets,
  systemRules,
  bridgeEditPrompt,
  motionRules,
}: Props) {
  const prevScene = sceneIndex > 0 ? project.scenes[sceneIndex - 1] : null;
  const nextScene = sceneIndex < project.scenes.length - 1 ? project.scenes[sceneIndex + 1] : null;

  const keyframeSource = scene.keyframeSource ?? defaultKeyframeSource(sceneIndex);
  const videoSource = scene.videoSource ?? defaultVideoSource(sceneIndex);
  const textToVideo = usesTextToVideo(scene, sceneIndex);
  const uploadOpening = usesOpeningUpload(scene, sceneIndex);
  const referenceWorkflow = usesReferenceWorkflow(keyframeSource, sceneIndex);

  const prevVideoId = prevScene ? resolveSceneVideoId(prevScene, assets) : undefined;
  const prevKeyframeId = prevScene ? resolveSceneKeyframeId(prevScene, assets) : undefined;
  const ownVideoId = resolveSceneVideoId(scene, assets);
  const ownKeyframeId = resolveSceneKeyframeId(scene, assets);

  const methodCtx: KeyframeMethodContext = useMemo(
    () => ({
      sceneIndex,
      hasApiKey: config.hasApiKey,
      canUsePrevVideo: Boolean(prevScene && prevVideoId),
      prevKeyframeId,
      canUseOwnVideo: Boolean(ownVideoId),
      hasKeyframe: Boolean(ownKeyframeId),
    }),
    [
      sceneIndex,
      config.hasApiKey,
      prevScene,
      prevVideoId,
      prevKeyframeId,
      ownVideoId,
      ownKeyframeId,
    ]
  );

  const uploadRef = useRef<ImageUploadZoneHandle>(null);

  const activeKeyframeId = resolveSceneKeyframeId(scene, assets);
  const keyframeUrl = assetFileUrl(activeKeyframeId, assets);
  const videoUrl = assetFileUrl(scene.videoId, assets);

  const patchScene = (patch: Partial<Scene>) =>
    onPersist({
      ...project,
      scenes: updateScene(project.scenes, scene.id, patch),
    });

  const selectGalleryKeyframe = async (asset: AssetType) => {
    const fromOther = asset.sceneId && asset.sceneId !== scene.id;
    await patchScene({
      keyframeId: asset.id,
      keyframeSource: asset.source === "upload" ? "upload" : "gallery",
      bridgedFromSceneId: undefined,
      imagePrompt:
        asset.source === "upload" || fromOther
          ? scene.imagePrompt?.trim() || "Selected still image"
          : scene.imagePrompt,
      status: "keyframe",
      error: undefined,
    });
    setStatus(
      fromOther
        ? `Using image from “${project.scenes.find((s) => s.id === asset.sceneId)?.title ?? "another scene"}”.`
        : "Keyframe updated from library."
    );
  };

  const applyUploadedKeyframe = async (file: File) => {
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const asset = await uploadKeyframeImage(file, {
        sceneId: scene.id,
        label: scene.title,
      });
      await patchScene({
        keyframeId: asset.id,
        keyframeSource: "upload",
        ...(sceneIndex === 0 ? { videoSource: "upload" as const } : {}),
        bridgedFromSceneId: undefined,
        imagePrompt: scene.imagePrompt?.trim() || "User-provided keyframe still",
        status: "keyframe",
        error: undefined,
      });
      await onReloadAssets();
      setStatus("Keyframe set from your image — generate video when ready.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchScene({ status: "error", error: msg });
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  const runKeyframe = async () => {
    if (!canRunKeyframeAction(keyframeSource, methodCtx)) return;

    setBusy(true);
    try {
      if (keyframeSource === "prompt") {
        setStatus(`Generating keyframe (${ks.imageResolution})…`);
        const prompt = buildKeyframePrompt(scene.imagePrompt, {
          isContinuation: sceneIndex > 0,
          lookBible: project.lookBible,
          systemRules,
        });
        const asset = await generateImage({
          prompt,
          sceneId: scene.id,
          label: scene.title,
          aspect_ratio: ks.aspectRatio,
          resolution: ks.imageResolution,
          model: ks.imageModel,
        });
        await patchScene({
          keyframeId: asset.id,
          bridgedFromSceneId: undefined,
          imagePrompt: scene.imagePrompt,
          status: "keyframe",
          error: undefined,
        });
        setStatus("Keyframe ready — generate video.");
      } else if (keyframeSource === "edit_existing") {
        const sourceId = ownKeyframeId!;
        setStatus("Editing keyframe from prompt…");
        const prompt =
          buildKeyframePrompt(scene.imagePrompt, {
            isContinuation: sceneIndex > 0,
            lookBible: project.lookBible,
            systemRules,
          }) || "Enhance to 2K cinematic quality, preserve composition exactly";
        const asset = await editImage({
          prompt,
          sourceAssetId: sourceId,
          sceneId: scene.id,
          label: scene.title,
          aspect_ratio: ks.aspectRatio,
          resolution: ks.imageResolution,
          model: ks.imageModel,
        });
        await patchScene({
          keyframeId: asset.id,
          status: "keyframe",
          error: undefined,
        });
        setStatus("Edited keyframe ready.");
      } else if (keyframeSource === "hd_existing") {
        const sourceId = ownKeyframeId!;
        setStatus("HD optimizing current keyframe…");
        const asset = await editImage({
          prompt: buildBridgeEditPrompt(systemRules, bridgeEditPrompt),
          sourceAssetId: sourceId,
          sceneId: scene.id,
          label: `${scene.title} HD`,
          aspect_ratio: ks.aspectRatio,
          resolution: ks.imageResolution,
          model: ks.imageModel,
        });
        await patchScene({
          keyframeId: asset.id,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus("HD keyframe ready.");
      } else if (keyframeSource === "reuse_prev_keyframe") {
        await patchScene({
          keyframeId: prevKeyframeId!,
          bridgedFromSceneId: prevScene!.id,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus(`Reusing keyframe from “${prevScene!.title}”.`);
      } else if (keyframeSource === "first_frame_prev") {
        setStatus(`First frame from “${prevScene!.title}”…`);
        const { frameAsset } = await extractFirstFrame({
          videoAssetId: prevVideoId!,
          sceneId: scene.id,
        });
        await patchScene({
          keyframeId: frameAsset.id,
          bridgedFromSceneId: prevScene!.id,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus("First frame ready.");
      } else if (keyframeSource === "last_frame") {
        setStatus(`Last frame from “${prevScene!.title}”…`);
        const { frameAsset } = await extractLastFrame({
          videoAssetId: prevVideoId!,
          sceneId: scene.id,
        });
        await patchScene({
          keyframeId: frameAsset.id,
          bridgedFromSceneId: prevScene!.id,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus("Last frame ready.");
      } else if (keyframeSource === "self_last_frame") {
        setStatus("Extracting last frame from this clip…");
        const { frameAsset } = await extractLastFrame({
          videoAssetId: ownVideoId!,
          sceneId: scene.id,
        });
        await patchScene({
          keyframeId: frameAsset.id,
          bridgedFromSceneId: undefined,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus("Last frame from this clip ready.");
      } else if (keyframeSource === "self_last_frame_hd") {
        setStatus("Last frame + HD from this clip…");
        const { hdAsset } = await lastFrameHd({
          videoAssetId: ownVideoId!,
          sceneId: scene.id,
          editPrompt: buildBridgeEditPrompt(systemRules, bridgeEditPrompt),
          aspect_ratio: ks.aspectRatio,
          resolution: ks.imageResolution,
          model: ks.imageModel,
        });
        await patchScene({
          keyframeId: hdAsset.id,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus("HD frame from this clip ready.");
      } else {
        setStatus(`Last frame + HD from “${prevScene!.title}”…`);
        const { hdAsset } = await lastFrameHd({
          videoAssetId: prevVideoId!,
          sceneId: scene.id,
          editPrompt: buildBridgeEditPrompt(systemRules, bridgeEditPrompt),
          aspect_ratio: ks.aspectRatio,
          resolution: ks.imageResolution,
          model: ks.imageModel,
        });
        await patchScene({
          keyframeId: hdAsset.id,
          bridgedFromSceneId: prevScene!.id,
          imagePrompt: REF_STILL,
          status: "keyframe",
          error: undefined,
        });
        setStatus("HD bridge frame ready.");
      }
      await onReloadAssets();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchScene({ status: "error", error: msg });
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  const runVideo = async () => {
    const prompt = buildSceneVideoGenerationPrompt(scene, motionRules, {
      brief: project.logline?.trim() || project.title,
      lookBible: project.lookBible,
      sceneIndex,
    });
    if (!prompt.trim()) {
      setStatus("Add a video prompt, camera motion, or scene description.");
      return;
    }
    let keyframeId = resolveSceneKeyframeId(scene, assets) ?? scene.keyframeId;
    const openingStillText =
      scene.visualBeat?.trim() || scene.imagePrompt?.trim() || "";
    if (!keyframeId) {
      if (uploadOpening) {
        setStatus("Upload an opening still below, or switch to AI opening still.");
        return;
      }
      if (!textToVideo) {
        setStatus("Create a keyframe on the Keyframe tab, or switch opening mode.");
        return;
      }
      if (!openingStillText) {
        setStatus("Add image prompt or beat staging for the opening still.");
        return;
      }
    }

    setBusy(true);
    try {
      if (!keyframeId) {
        const imgBody = maxQualityImageBody(ks, config);
        setStatus(`Opening still (${imgBody.resolution} · ${imgBody.model})…`);
        const still = await generateImage({
          prompt: buildKeyframePrompt(openingStillText, {
            isContinuation: sceneIndex > 0,
            lookBible: project.lookBible,
            systemRules,
          }),
          sceneId: scene.id,
          label: scene.title,
          ...imgBody,
        });
        await patchScene({
          keyframeId: still.id,
          bridgedFromSceneId: undefined,
          imagePrompt: scene.imagePrompt || openingStillText,
          status: "keyframe",
          error: undefined,
        });
        keyframeId = still.id;
        await onReloadAssets();
      }

      setStatus("Generating video (grok-imagine-video-1.5-preview)…");
      const asset = await generateVideo({
        prompt,
        sourceImageId: keyframeId!,
        sceneId: scene.id,
        duration: ks.videoDuration ?? config.defaults.videoDuration,
        aspect_ratio: ks.aspectRatio,
        resolution: ks.videoResolution,
      });
      await patchScene({
        videoId: asset.id,
        status: "video",
        error: undefined,
      });
      await onReloadAssets();
      setStatus(
        nextScene
          ? "Clip ready — bridge or plan the next scene’s keyframe method."
          : "Clip ready."
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patchScene({ status: "error", error: msg });
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  };

  const applyBridgeToScene = async (
    target: Scene,
    method: KeyframeSource,
    sourceVideoId: string,
    fromSceneId: string,
    freshAssets: Asset[]
  ) => {
    if (method === "reuse_prev_keyframe") {
      const fromScene = project.scenes.find((s) => s.id === fromSceneId);
      const kf = fromScene ? resolveSceneKeyframeId(fromScene, freshAssets) : undefined;
      if (!kf) throw new Error("Source scene has no keyframe to reuse.");
      return {
        keyframeId: kf,
        bridgedFromSceneId: fromSceneId,
        imagePrompt: REF_STILL,
        status: "keyframe" as const,
        error: undefined,
      };
    }
    if (method === "first_frame_prev") {
      const { frameAsset } = await extractFirstFrame({
        videoAssetId: sourceVideoId,
        sceneId: target.id,
      });
      return {
        keyframeId: frameAsset.id,
        bridgedFromSceneId: fromSceneId,
        imagePrompt: REF_STILL,
        status: "keyframe" as const,
        error: undefined,
      };
    }
    if (method === "last_frame") {
      const { frameAsset } = await extractLastFrame({
        videoAssetId: sourceVideoId,
        sceneId: target.id,
      });
      return {
        keyframeId: frameAsset.id,
        bridgedFromSceneId: fromSceneId,
        imagePrompt: REF_STILL,
        status: "keyframe" as const,
        error: undefined,
      };
    }
    const { hdAsset } = await lastFrameHd({
      videoAssetId: sourceVideoId,
      sceneId: target.id,
      editPrompt: buildBridgeEditPrompt(systemRules, bridgeEditPrompt),
      aspect_ratio: ks.aspectRatio,
      resolution: ks.imageResolution,
      model: ks.imageModel,
    });
    return {
      keyframeId: hdAsset.id,
      bridgedFromSceneId: fromSceneId,
      imagePrompt: REF_STILL,
      status: "keyframe" as const,
      error: undefined,
    };
  };

  const bridgeToNext = async () => {
    if (!nextScene || !scene.videoId) {
      setStatus("Finish this scene’s video first.");
      return;
    }
    const freshAssets = await onReloadAssets();
    const sourceId = resolveSceneVideoId(scene, freshAssets);
    if (!sourceId) return;

    setBusy(true);
    setStatus(`Bridging into “${nextScene.title}”…`);
    try {
      const method = nextScene.keyframeSource ?? defaultKeyframeSource(sceneIndex + 1);
      const patch = await applyBridgeToScene(
        nextScene,
        method,
        sourceId,
        scene.id,
        freshAssets
      );
      await onPersist({
        ...project,
        selectedSceneId: nextScene.id,
        scenes: updateScene(project.scenes, nextScene.id, patch),
      });
      await onReloadAssets();
      setStatus(`Bridged into ${nextScene.title}.`);
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const runAlign = async () => {
    setBusy(true);
    setStatus("Syncing beat staging with script…");
    try {
      const aligned = await alignSceneScript({
        imagePrompt: scene.visualBeat?.trim() || scene.imagePrompt,
        dialogue: scene.dialogue,
        title: scene.title,
        brief: project.logline?.trim() || project.title,
      });
      await patchScene({
        visualBeat: referenceWorkflow ? aligned.imagePrompt : scene.visualBeat,
        dialogue: aligned.dialogue,
        imagePrompt: referenceWorkflow ? REF_STILL : aligned.imagePrompt,
      });
      setStatus("Script synced — regenerate keyframe when ready.");
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const [tab, setTab] = useState<InspectorTab>(() => defaultInspectorTab(scene, sceneIndex));

  useEffect(() => {
    setTab(defaultInspectorTab(scene, sceneIndex));
  }, [scene.id]);

  const bridgeDone = Boolean(
    nextScene?.bridgedFromSceneId === scene.id && nextScene.keyframeId
  );
  const keyframeStepDone = Boolean(scene.keyframeId);
  const videoStepDone = Boolean(scene.videoId);

  const onMethodChange = (id: KeyframeSource) => {
    const patch: Partial<Scene> = { keyframeSource: id };
    if (id === "prompt" && sceneIndex > 0) {
      patch.imagePrompt = scene.visualBeat?.trim() || scene.imagePrompt || "";
    } else if (
      id !== "prompt" &&
      id !== "upload" &&
      id !== "edit_existing" &&
      id !== "hd_existing"
    ) {
      patch.imagePrompt = REF_STILL;
    }
    const group = keyframeMethodGroup(id);
    if (group === "previous") setTab("bridge");
    else if (group === "this_clip") setTab("video");
    else if (group && KEYFRAME_TAB_GROUPS.includes(group as (typeof KEYFRAME_TAB_GROUPS)[number])) {
      setTab("keyframe");
    }
    void patchScene(patch);
  };

  const methodGroup = keyframeMethodGroup(keyframeSource);

  return (
    <>
      <div className="inspector-tabs" role="tablist" aria-label="Scene workflow">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "keyframe"}
          className={`inspector-tab${tab === "keyframe" ? " is-active" : ""}${keyframeStepDone ? " is-done" : ""}`}
          onClick={() => setTab("keyframe")}
        >
          <span className="inspector-tab-step">1</span>
          Keyframe
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "video"}
          className={`inspector-tab${tab === "video" ? " is-active" : ""}${videoStepDone ? " is-done" : ""}`}
          onClick={() => setTab("video")}
        >
          <span className="inspector-tab-step">2</span>
          Video
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bridge"}
          className={`inspector-tab${tab === "bridge" ? " is-active" : ""}${bridgeDone ? " is-done" : ""}`}
          onClick={() => setTab("bridge")}
        >
          <span className="inspector-tab-step">3</span>
          Bridge
        </button>
      </div>

      {tab === "keyframe" && (
        <div className="inspector-tab-panel" role="tabpanel">
          <section className="preview-panel">
            {keyframeUrl ? (
              <div className="preview-block">
                <h3>Keyframe</h3>
                <img src={keyframeUrl} alt="" className="preview-media" />
              </div>
            ) : (
              <p className="hint preview-empty">
                {sceneIndex === 0
                  ? "Generate or upload a 2K still for this scene."
                  : "Pick a method below, or use the Bridge tab to continue from the previous clip."}
              </p>
            )}
          </section>

          <ImageGallery
            project={project}
            sceneId={scene.id}
            assets={assets}
            activeKeyframeId={activeKeyframeId}
            disabled={busy}
            onSelect={(asset) => void selectGalleryKeyframe(asset)}
          />

          <KeyframeMethodPicker
            sceneId={scene.id}
            sceneIndex={sceneIndex}
            selected={keyframeSource}
            methodCtx={methodCtx}
            disabled={busy}
            includeGroups={[...KEYFRAME_TAB_GROUPS]}
            title="Still source"
            subtitle="Generate, upload, or refine the keyframe for this scene."
            onChange={onMethodChange}
            onUploadClick={() => uploadRef.current?.openFilePicker()}
          />

          <ImageUploadZone
            ref={uploadRef}
            disabled={busy}
            busy={busy}
            hasKeyframe={Boolean(activeKeyframeId)}
            highlight={keyframeSource === "upload"}
            compact={keyframeSource !== "upload"}
            onFile={applyUploadedKeyframe}
          />

          {sceneIndex === 0 &&
            !scene.imagePrompt?.trim() &&
            !scene.visualBeat?.trim() &&
            project.scenes.length > 1 && (
              <p className="hint method-warn">
                This empty Scene 1 was left over from a blank project — it was not part of
                your AI plan. Remove it and use Scene 2 onward, or type an opening shot
                prompt here.
              </p>
            )}

          {referenceWorkflow ? (
            <>
              <label>Beat staging (reference still)</label>
              <textarea
                rows={4}
                value={scene.visualBeat ?? ""}
                onChange={(e) => patchScene({ visualBeat: e.target.value })}
              />
              <label>Image prompt (sent to image API)</label>
              <textarea rows={2} readOnly value={REF_STILL} />
              <p className="hint">
                Bridged scenes use a fixed reference still; staging lives in beat staging
                and video prompts.
              </p>
            </>
          ) : (
            <>
              <label>Image prompt (2K still)</label>
              <textarea
                rows={4}
                value={scene.imagePrompt}
                onChange={(e) => patchScene({ imagePrompt: e.target.value })}
              />
              {(keyframeSource === "edit_existing" || keyframeSource === "prompt") && (
                <p className="hint">
                  {keyframeSource === "edit_existing"
                    ? "Edit instruction: describe what to change while keeping the same staging."
                    : "Full scene description sent to the image model."}
                </p>
              )}
            </>
          )}

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !canRunKeyframeAction(keyframeSource, methodCtx)}
              onClick={() => void runKeyframe()}
            >
              {keyframeActionLabel(keyframeSource, Boolean(scene.keyframeId))}
            </button>
          </div>
        </div>
      )}

      {tab === "video" && (
        <div className="inspector-tab-panel" role="tabpanel">
          <section className="preview-panel">
            {videoUrl ? (
              <div className="preview-block">
                <h3>Clip</h3>
                <video src={videoUrl} controls playsInline className="preview-media" />
              </div>
            ) : (
              <p className="hint preview-empty">
                {textToVideo
                  ? "Set prompts below — max-quality 2K still, then 1.5-preview video."
                  : uploadOpening
                    ? activeKeyframeId
                      ? "Opening still ready — set motion prompts and generate video."
                      : "Upload your opening image below (required before YOLO)."
                    : scene.keyframeId
                      ? "Set motion prompts below, then generate video from the keyframe."
                      : "Create a keyframe on the Keyframe tab, or pick an opening mode above."}
              </p>
            )}
          </section>

          <VideoSourcePicker
            sceneId={scene.id}
            sceneIndex={sceneIndex}
            selected={videoSource}
            hasOpeningStill={Boolean(activeKeyframeId)}
            disabled={busy}
            onChange={(id: VideoSource) => {
              const patch: Partial<Scene> = { videoSource: id };
              if (id === "upload") patch.keyframeSource = "upload";
              if (id === "text" && sceneIndex === 0) patch.keyframeSource = "prompt";
              void patchScene(patch);
            }}
          />

          {sceneIndex === 0 && uploadOpening && (
            <ImageUploadZone
              ref={uploadRef}
              disabled={busy}
              busy={busy}
              hasKeyframe={Boolean(activeKeyframeId)}
              highlight
              onFile={applyUploadedKeyframe}
            />
          )}

          {ownVideoId && (
            <KeyframeMethodPicker
              sceneId={scene.id}
              sceneIndex={sceneIndex}
              selected={keyframeSource}
              methodCtx={methodCtx}
              disabled={busy}
              includeGroups={[...VIDEO_TAB_GROUPS]}
              title="Re-keyframe from this clip"
              subtitle="Optional: pull a new still from this scene’s finished video."
              onChange={onMethodChange}
            />
          )}

          <label>Video prompt</label>
          <textarea
            rows={3}
            value={scene.videoPrompt ?? ""}
            onChange={(e) => patchScene({ videoPrompt: e.target.value })}
          />

          <label>Camera motion</label>
          <textarea
            rows={2}
            value={scene.motionPrompt}
            onChange={(e) => patchScene({ motionPrompt: e.target.value })}
          />

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !config.hasApiKey}
              onClick={() => void runVideo()}
            >
              {scene.videoId
                ? "Regenerate video"
                : textToVideo
                  ? "Generate opening clip"
                  : uploadOpening
                    ? "Generate from upload"
                    : "Generate image-to-video"}
            </button>
            {methodGroup === "this_clip" && canRunKeyframeAction(keyframeSource, methodCtx) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void runKeyframe()}
                >
                  {keyframeActionLabel(keyframeSource, Boolean(scene.keyframeId))}
                </button>
              )}
          </div>

          <p className="hint">
            {config.videoModel} ·{" "}
            {textToVideo
              ? "2K quality still → video"
              : uploadOpening
                ? "upload → video"
                : "image-to-video"}{" "}
            ·{" "}
            {ks.videoResolution} · {ks.videoDuration ?? config.defaults.videoDuration}s ·{" "}
            {ks.aspectRatio}
          </p>
        </div>
      )}

      {tab === "bridge" && (
        <div className="inspector-tab-panel" role="tabpanel">
          {sceneIndex === 0 ? (
            <p className="hint bridge-intro">
              Scene 1 starts fresh{textToVideo ? " (prompts → still → video on the Video tab)" : ""}. After
              this clip’s video is ready, bridge into scene 2 here.
            </p>
          ) : (
            <>
              <p className="hint bridge-intro">
                Continue from “{prevScene?.title}” — pick how this scene inherits the previous
                clip, then run the action.
              </p>

              <KeyframeMethodPicker
                sceneId={scene.id}
                sceneIndex={sceneIndex}
                selected={keyframeSource}
                methodCtx={methodCtx}
                disabled={busy}
                includeGroups={[...BRIDGE_TAB_GROUPS]}
                title="Continuity from previous scene"
                subtitle="Reuse or extract frames from the previous scene’s video."
                onChange={onMethodChange}
                onUploadClick={() => uploadRef.current?.openFilePicker()}
              />

              {referenceWorkflow && (
                <>
                  <label>Beat staging (script sync)</label>
                  <textarea
                    rows={3}
                    value={scene.visualBeat ?? ""}
                    onChange={(e) => patchScene({ visualBeat: e.target.value })}
                  />
                  <label>Image prompt (reference still)</label>
                  <textarea rows={2} readOnly value={REF_STILL} />
                  <div className="actions actions-inline">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy || !config.hasApiKey}
                      onClick={() => void runAlign()}
                    >
                      Sync image &amp; script
                    </button>
                  </div>
                </>
              )}

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !canRunKeyframeAction(keyframeSource, methodCtx)}
                  onClick={() => void runKeyframe()}
                >
                  {keyframeActionLabel(keyframeSource, Boolean(scene.keyframeId))}
                </button>
              </div>
            </>
          )}

          {nextScene ? (
            <section className="bridge-next-card">
              <h3 className="bridge-next-title">Next scene</h3>
              <p className="hint">
                <strong>{nextScene.title}</strong>
                {nextScene.bridgedFromSceneId === scene.id
                  ? " — keyframe linked from this clip."
                  : scene.videoId
                    ? " — ready to receive a bridge from this clip."
                    : " — finish this scene’s video to enable bridging."}
              </p>
              {scene.videoId && (
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !config.hasApiKey}
                    onClick={() => void bridgeToNext()}
                  >
                    Bridge into next scene
                  </button>
                </div>
              )}
            </section>
          ) : (
            <p className="hint">Last scene in the project — no bridge target.</p>
          )}

          <p className="hint">
            {ks.imageModel} · {ks.imageResolution} · bridge HD uses project settings
          </p>
        </div>
      )}

      {scene.error && <p className="status error">{scene.error}</p>}
      {!busy && status ? <p className="status">{status}</p> : null}
    </>
  );
}