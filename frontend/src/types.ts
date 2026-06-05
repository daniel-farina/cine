/** Scene 1 opening: max-quality still from prompts, user upload, or existing keyframe. */
export type VideoSource = "text" | "upload" | "image";

/** How this scene gets its keyframe still. */

export type KeyframeSource =
  | "prompt"
  | "upload"
  | "edit_existing"
  | "hd_existing"
  | "reuse_prev_keyframe"
  | "last_frame"
  | "last_frame_hd"
  | "first_frame_prev"
  | "self_last_frame"
  | "self_last_frame_hd"
  | "gallery";

export type Scene = {
  id: string;
  title: string;
  imagePrompt: string;
  visualBeat?: string;
  videoPrompt?: string;
  dialogue?: string;
  motionPrompt: string;
  shotKind?: "dialogue" | "transition";
  storyBeat?: string;
  continuityIn?: string;
  endState?: string;
  /** Per-scene keyframe method (defaults by scene index). */
  keyframeSource?: KeyframeSource;
  videoSource?: VideoSource;
  keyframeId?: string;
  videoId?: string;
  bridgedFromSceneId?: string;
  status: "empty" | "generating" | "keyframe" | "video" | "error";
  error?: string;
};

export type VideoApiPayloadStored = {
  recordedAt: string;
  client: Record<string, unknown>;
  xai: Record<string, unknown>;
  xaiStart?: Record<string, unknown>;
  note?: string;
};

export type Asset = {
  id: string;
  type: "image" | "video" | "frame" | "film";
  filename: string;
  url: string;
  remoteUrl?: string;
  prompt?: string;
  sceneId?: string;
  label?: string;
  sourceAssetId?: string;
  sourceImageId?: string;
  source?: string;
  model?: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  apiPayload?: VideoApiPayloadStored;
  createdAt: string;
};

export type Project = {
  id: string;
  title: string;
  logline: string;
  scenes: Scene[];
  selectedSceneId: string | null;
  lookBible?: string;
  storySpine?: string;
  keyframeSettings?: KeyframeSettings;
  systemRules?: string[];
  plannerMode?: import("./planningModes").PlanningMode;
  narrativeMode?: string;
  bridgeEditPrompt?: string;
  motionRules?: string;
};

export type ProjectMeta = {
  id: string;
  title: string;
  updatedAt: string;
  sceneCount: number;
  posterAssetId?: string;
};

export type ProjectsIndex = {
  activeId: string | null;
  projects: ProjectMeta[];
};

export type KeyframeSettings = {
  aspectRatio: string;
  imageResolution: string;
  imageModel: string;
  videoDuration?: number;
  videoResolution?: string;
};

export type Config = {
  imageModels: { id: string; label: string }[];
  videoModel: string;
  videoResolution?: string;
  videoResolutions?: string[];
  imageResolutions: string[];
  aspectRatios: string[];
  defaults: KeyframeSettings & { videoDuration: number };
  hasApiKey: boolean;
};

export type AppSettings = {
  keyframeSettings: KeyframeSettings;
  systemRules: string[];
  plannerMode: import("./planningModes").PlanningMode;
  narrativeMode: string;
  narrativeModes: import("./narrativeModes").NarrativeModeDefinition[];
  defaultSceneCount: number;
  bridgeEditPrompt?: string;
  motionRules?: string;
};