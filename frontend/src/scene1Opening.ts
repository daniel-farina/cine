import { uploadKeyframeImage } from "./api";
import {
  defaultVideoSource,
  usesOpeningUpload,
  type VideoSource,
} from "./prompts";
import { resolveSceneKeyframeId } from "./sceneAssets";
import type { Asset, Project, Scene } from "./types";

const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif";

function updateScene(scenes: Scene[], id: string, patch: Partial<Scene>): Scene[] {
  return scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/** YOLO / planner preference for Scene 1 first frame (before scenes exist). */
export function resolveYoloOpeningMode(
  project: Project | null,
  yoloPreference: VideoSource
): VideoSource {
  const scene = project?.scenes[0];
  if (scene?.videoSource) return scene.videoSource;
  return yoloPreference;
}

export function needsYoloOpeningUpload(
  project: Project,
  assets: Asset[],
  mode: VideoSource
): boolean {
  if (mode !== "upload") return false;
  const scene = project.scenes[0];
  if (!scene) return true;
  return !resolveSceneKeyframeId(scene, assets);
}

export function scene1OpeningBlocker(
  project: Project,
  assets: Asset[],
  mode?: VideoSource
): string | null {
  const scene = project.scenes[0];
  const m = mode ?? (scene ? scene.videoSource ?? defaultVideoSource(0) : "upload");
  if (!needsYoloOpeningUpload(project, assets, m)) return null;
  return "Choose an opening image to continue (use the upload step below or click YOLO again).";
}

export function projectWithScene1OpeningMode(
  project: Project,
  mode: VideoSource
): Project {
  const scene = project.scenes[0];
  if (!scene) return project;
  if (mode === "upload") {
    return {
      ...project,
      scenes: updateScene(project.scenes, scene.id, {
        videoSource: "upload",
        keyframeSource: "upload",
      }),
      selectedSceneId: scene.id,
    };
  }
  if (mode === "text") {
    return {
      ...project,
      scenes: updateScene(project.scenes, scene.id, {
        videoSource: "text",
        keyframeSource: scene.keyframeSource ?? "prompt",
      }),
      selectedSceneId: scene.id,
    };
  }
  return project;
}

/** Opens the system file picker for one image. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] ?? null);
      },
      { once: true }
    );
    input.click();
  });
}

export async function uploadOpeningStill(
  project: Project,
  file: File,
  persistProject: (p: Project) => Promise<unknown>
): Promise<Asset> {
  const scene = project.scenes[0];
  if (!scene) throw new Error("Scene 1 missing — plan scenes first.");
  const asset = await uploadKeyframeImage(file, {
    sceneId: scene.id,
    label: scene.title,
  });
  await persistProject({
    ...project,
    scenes: updateScene(project.scenes, scene.id, {
      keyframeId: asset.id,
      keyframeSource: "upload",
      videoSource: "upload",
      bridgedFromSceneId: undefined,
      imagePrompt: scene.imagePrompt?.trim() || `User opening still: ${file.name}`,
      status: "keyframe",
      error: undefined,
    }),
    selectedSceneId: scene.id,
  });
  return asset;
}

function scene1HasOpeningStill(project: Project, assets: Asset[]): boolean {
  const scene = project.scenes[0];
  if (!scene) return false;
  return Boolean(
    resolveSceneKeyframeId(scene, assets) ||
      assets.some((a) => a.id === scene.keyframeId && a.type === "image")
  );
}

const OPENING_UPLOAD_POLL_MS = 500;
const OPENING_UPLOAD_POLL_MAX = 120;

/** Prompt for file if needed; returns true when Scene 1 has an opening still. */
export async function ensureYoloOpeningUpload(opts: {
  project: Project;
  assets: Asset[];
  mode: VideoSource;
  getProject?: () => Project | null;
  persistProject: (p: Project) => Promise<unknown>;
  refreshAssets: () => Promise<Asset[]>;
  onStatus: (msg: string) => void;
  /** If true, open the file picker when still missing (drop zone can finish upload too). */
  promptPicker?: boolean;
  shouldAbort?: () => boolean;
}): Promise<{ ok: boolean; assets: Asset[] }> {
  let assets = opts.assets;
  let project = opts.getProject?.() ?? opts.project;

  if (!needsYoloOpeningUpload(project, assets, opts.mode)) {
    return { ok: true, assets };
  }

  opts.onStatus("YOLO needs your opening image for Scene 1…");

  if (opts.promptPicker) {
    const file = await pickImageFile();
    if (file) {
      opts.onStatus(`Uploading ${file.name}…`);
      await uploadOpeningStill(project, file, opts.persistProject);
      assets = await opts.refreshAssets();
      project = opts.getProject?.() ?? project;
      if (scene1HasOpeningStill(project, assets)) {
        opts.onStatus("Opening still ready — continuing YOLO…");
        return { ok: true, assets };
      }
      opts.onStatus("Upload failed — try again.");
      return { ok: false, assets };
    }
    opts.onStatus("Drop an opening image below, or click YOLO again to browse…");
    for (let i = 0; i < OPENING_UPLOAD_POLL_MAX; i++) {
      if (opts.shouldAbort?.()) {
        opts.onStatus("YOLO stopped — opening image still required.");
        return { ok: false, assets };
      }
      await new Promise((r) => setTimeout(r, OPENING_UPLOAD_POLL_MS));
      assets = await opts.refreshAssets();
      project = opts.getProject?.() ?? project;
      if (!needsYoloOpeningUpload(project, assets, opts.mode)) {
        opts.onStatus("Opening still ready — continuing YOLO…");
        return { ok: true, assets };
      }
    }
    opts.onStatus("YOLO timed out — upload an opening image, then run YOLO again.");
    return { ok: false, assets };
  }

  return { ok: false, assets };
}

export function isScene1UploadMode(scene: Scene | undefined, sceneIndex: number): boolean {
  return scene ? usesOpeningUpload(scene, sceneIndex) : false;
}