import type { KeyframeSource } from "./types";

export type KeyframeMethodDef = {
  id: KeyframeSource;
  label: string;
  hint: string;
  group: "generate" | "previous" | "this_clip" | "refine" | "import";
  /** Use upload drop zone instead of Generate button */
  usesUploadZone?: boolean;
  requiresApiKey?: boolean;
  requiresPrevVideo?: boolean;
  requiresPrevKeyframe?: boolean;
  requiresOwnVideo?: boolean;
  requiresOwnKeyframe?: boolean;
  sceneIndexMin?: number;
};

export const KEYFRAME_METHODS: KeyframeMethodDef[] = [
  {
    id: "prompt",
    label: "Text → 2K still",
    hint: "Generate a new keyframe from the image prompt.",
    group: "generate",
    requiresApiKey: true,
  },
  {
    id: "edit_existing",
    label: "Edit current still (AI)",
    hint: "Re-interpret the current keyframe using the image prompt as an edit instruction.",
    group: "refine",
    requiresApiKey: true,
    requiresOwnKeyframe: true,
  },
  {
    id: "hd_existing",
    label: "HD optimize current still",
    hint: "Upscale and restore the current keyframe to clean 2K (same composition).",
    group: "refine",
    requiresApiKey: true,
    requiresOwnKeyframe: true,
  },
  {
    id: "upload",
    label: "Upload from computer",
    hint: "Your file — drag into the upload area or browse.",
    group: "import",
    usesUploadZone: true,
  },
  {
    id: "reuse_prev_keyframe",
    label: "Reuse previous keyframe",
    hint: "Use the previous scene’s keyframe as-is (instant, no API).",
    group: "previous",
    requiresPrevKeyframe: true,
    sceneIndexMin: 1,
  },
  {
    id: "last_frame_hd",
    label: "Previous clip → last frame + HD",
    hint: "Extract the last frame from the previous video, then upscale (recommended bridge).",
    group: "previous",
    requiresApiKey: true,
    requiresPrevVideo: true,
    sceneIndexMin: 1,
  },
  {
    id: "last_frame",
    label: "Previous clip → last frame (raw)",
    hint: "Grab the final frame from the previous video — no HD pass.",
    group: "previous",
    requiresApiKey: true,
    requiresPrevVideo: true,
    sceneIndexMin: 1,
  },
  {
    id: "first_frame_prev",
    label: "Previous clip → first frame",
    hint: "Use the opening frame of the previous video (hard cut / new angle).",
    group: "previous",
    requiresApiKey: true,
    requiresPrevVideo: true,
    sceneIndexMin: 1,
  },
  {
    id: "self_last_frame_hd",
    label: "This clip → last frame + HD",
    hint: "Re-extract and upscale the last frame of this scene’s video.",
    group: "this_clip",
    requiresApiKey: true,
    requiresOwnVideo: true,
  },
  {
    id: "self_last_frame",
    label: "This clip → last frame (raw)",
    hint: "Re-use the final frame from this scene’s video as the keyframe.",
    group: "this_clip",
    requiresApiKey: true,
    requiresOwnVideo: true,
  },
];

const GROUP_LABELS: Record<KeyframeMethodDef["group"], string> = {
  generate: "Generate",
  import: "Import",
  previous: "From previous scene",
  this_clip: "From this scene’s video",
  refine: "Refine current keyframe",
};

export type KeyframeMethodContext = {
  sceneIndex: number;
  hasApiKey: boolean;
  canUsePrevVideo: boolean;
  prevKeyframeId?: string;
  canUseOwnVideo: boolean;
  hasKeyframe: boolean;
};

export function availableKeyframeMethods(ctx: KeyframeMethodContext): KeyframeMethodDef[] {
  return KEYFRAME_METHODS.filter((m) => {
    if (m.sceneIndexMin != null && ctx.sceneIndex < m.sceneIndexMin) return false;
    if (ctx.sceneIndex === 0 && m.group === "previous") return false;
    if (ctx.sceneIndex === 0 && m.group === "this_clip") return false;
    return true;
  });
}

export function methodsByGroup(
  methods: KeyframeMethodDef[]
): { group: KeyframeMethodDef["group"]; label: string; items: KeyframeMethodDef[] }[] {
  const order: KeyframeMethodDef["group"][] = [
    "generate",
    "import",
    "previous",
    "this_clip",
    "refine",
  ];
  return order
    .map((group) => ({
      group,
      label: GROUP_LABELS[group],
      items: methods.filter((m) => m.group === group),
    }))
    .filter((g) => g.items.length > 0);
}

export function isMethodDisabled(m: KeyframeMethodDef, ctx: KeyframeMethodContext): boolean {
  if (m.usesUploadZone) return false;
  if (m.requiresApiKey && !ctx.hasApiKey) return true;
  if (m.requiresPrevVideo && !ctx.canUsePrevVideo) return true;
  if (m.requiresPrevKeyframe && !ctx.prevKeyframeId) return true;
  if (m.requiresOwnVideo && !ctx.canUseOwnVideo) return true;
  if (m.requiresOwnKeyframe && !ctx.hasKeyframe) return true;
  return false;
}

export function usesReferenceWorkflow(
  source: KeyframeSource,
  sceneIndex: number
): boolean {
  return (
    sceneIndex > 0 &&
    source !== "prompt" &&
    source !== "upload" &&
    source !== "edit_existing" &&
    source !== "hd_existing" &&
    source !== "reuse_prev_keyframe" &&
    source !== "gallery"
  );
}

export function keyframeActionLabel(
  source: KeyframeSource,
  hasKeyframe: boolean
): string {
  const def = KEYFRAME_METHODS.find((m) => m.id === source);
  if (def?.usesUploadZone) {
    return hasKeyframe ? "Replace via upload below" : "Upload an image below";
  }
  const verbs: Partial<Record<KeyframeSource, [string, string]>> = {
    prompt: ["Generate keyframe", "Regenerate keyframe"],
    edit_existing: ["Edit keyframe from prompt", "Re-edit keyframe"],
    hd_existing: ["HD optimize keyframe", "Re-optimize keyframe"],
    reuse_prev_keyframe: ["Reuse previous keyframe", "Re-apply previous keyframe"],
    last_frame_hd: ["Extract + HD from previous", "Re-extract + HD from previous"],
    last_frame: ["Extract last frame from previous", "Re-extract from previous"],
    first_frame_prev: ["Extract first frame from previous", "Re-extract first frame"],
    self_last_frame_hd: ["Extract + HD from this clip", "Re-extract + HD from this clip"],
    self_last_frame: ["Extract last frame from this clip", "Re-extract from this clip"],
  };
  const pair = verbs[source];
  if (pair) return hasKeyframe ? pair[1] : pair[0];
  return hasKeyframe ? "Regenerate keyframe" : "Generate keyframe";
}

export function canRunKeyframeAction(
  source: KeyframeSource,
  ctx: KeyframeMethodContext
): boolean {
  const def = KEYFRAME_METHODS.find((m) => m.id === source);
  if (!def || def.usesUploadZone) return false;
  return !isMethodDisabled(def, ctx);
}

export function keyframeMethodGroup(
  source: KeyframeSource
): KeyframeMethodDef["group"] | undefined {
  return KEYFRAME_METHODS.find((m) => m.id === source)?.group;
}