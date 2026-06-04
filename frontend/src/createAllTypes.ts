export type StepKind = "keyframe" | "video" | "bridge";

export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export type SceneStepMap = Record<StepKind, StepStatus>;

export type CreateAllProgress = {
  active: boolean;
  phase: "plan" | "upload" | "generate" | "idle";
  sceneIndex: number;
  currentStep: StepKind | null;
  label: string;
  overall: number;
  byScene: Record<string, SceneStepMap>;
};

export function emptySceneSteps(sceneIndex: number, sceneCount: number): SceneStepMap {
  return {
    keyframe: "pending",
    video: "pending",
    bridge: sceneIndex >= sceneCount - 1 ? "skipped" : "pending",
  };
}

export function computeOverall(
  byScene: Record<string, SceneStepMap>,
  sceneIds: string[]
): number {
  let total = 0;
  let done = 0;
  for (const id of sceneIds) {
    const steps = byScene[id];
    if (!steps) continue;
    for (const k of ["keyframe", "video", "bridge"] as StepKind[]) {
      if (steps[k] === "skipped") continue;
      total += 1;
      if (steps[k] === "done") done += 1;
    }
  }
  return total ? done / total : 0;
}

export function initCreateAll(sceneIds: string[], sceneCount: number): CreateAllProgress {
  const byScene: Record<string, SceneStepMap> = {};
  sceneIds.forEach((id, i) => {
    byScene[id] = emptySceneSteps(i, sceneCount);
  });
  return {
    active: true,
    phase: "generate",
    sceneIndex: 0,
    currentStep: null,
    label: "Starting…",
    overall: 0,
    byScene,
  };
}

export type ProgressPatch = Partial<CreateAllProgress> & {
  sceneId?: string;
  step?: StepKind;
  stepStatus?: StepStatus;
};

export function mergeCreateAllProgress(
  prev: CreateAllProgress,
  patch: ProgressPatch
): CreateAllProgress {
  const next: CreateAllProgress = { ...prev, ...patch };
  if (patch.sceneId && patch.step && patch.stepStatus) {
    next.byScene = {
      ...prev.byScene,
      [patch.sceneId]: {
        ...prev.byScene[patch.sceneId],
        [patch.step]: patch.stepStatus,
      },
    };
  }
  const ids = Object.keys(next.byScene);
  if (patch.overall === undefined && ids.length > 0) {
    next.overall = computeOverall(next.byScene, ids);
  }
  return next;
}