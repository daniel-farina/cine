/**
 * Server-side job runner — executes create_all / yolo / plan using the same pipeline as the UI.
 * Usage: npx tsx media-server/runPipeline.ts <jobId>
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import type { ScenePlan } from "../frontend/src/api.ts";
import {
  attachOpeningUploadToScene1,
  projectWithPlan,
  readOpeningUpload,
  type TimelineApplyMode,
} from "../frontend/src/applyScenePlan.ts";
import type { AppSettings, Asset, Config, Project } from "../frontend/src/types.ts";
import type { CreateAllProgress } from "../frontend/src/createAllTypes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.CINE_ROOT || path.join(__dirname, "..");
config({ path: path.join(root, ".env") });

const API = process.env.CINE_API_URL || "http://127.0.0.1:8792";

function patchFetchForServer() {
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api") || url.startsWith("/files")) {
      return orig(`${API}${url}`, init);
    }
    return orig(input, init);
  };
}

patchFetchForServer();

const { runCreateAllPipeline, CreateAllCancelled } = await import(
  "../frontend/src/createAllPipeline.ts"
);
const { initCreateAll, initPlanProgress, mergeCreateAllProgress } = await import(
  "../frontend/src/createAllTypes.ts"
);
const { effectiveSettings } = await import("../frontend/src/effectiveSettings.ts");

async function api<T>(urlPath: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${urlPath}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) throw new Error(String(data.error || data.message || `${res.status}`));
  return data as T;
}

async function patchJob(
  jobId: string,
  patch: {
    progress?: number;
    label?: string;
    progressDetail?: CreateAllProgress;
  }
) {
  await api(`/api/jobs/${jobId}/progress`, {
    method: "POST",
    body: JSON.stringify({
      progress: patch.progress,
      label: patch.label,
      progressDetail: patch.progressDetail,
    }),
  });
}

async function finishJob(
  jobId: string,
  status: "done" | "error" | "cancelled",
  error?: string,
  progressDetail?: CreateAllProgress
) {
  await api(`/api/jobs/${jobId}/finish`, {
    method: "POST",
    body: JSON.stringify({ status, error, progressDetail }),
  });
}

async function isCancelled(jobId: string): Promise<boolean> {
  const job = await api<{ status: string }>(`/api/jobs/${jobId}`);
  return job.status === "cancelled";
}

function planProgress(label: string, overall: number): CreateAllProgress {
  return { ...initPlanProgress(label), overall };
}

async function runPlanForProject(
  jobId: string,
  projectId: string,
  payload: Record<string, unknown>,
  studio: AppSettings,
  config: Config
): Promise<Project> {
  let project = await api<Project>(`/api/projects/${projectId}`);
  const apply = (payload.apply === "append" ? "append" : "replace") as TimelineApplyMode;
  const brief = String(payload.brief || "").trim();
  if (!brief) throw new Error("Film brief is required for planning.");

  const savedOpening = apply === "replace" ? readOpeningUpload(project.scenes) : null;

  let progress = planProgress("Planning scenes…", 0.05);
  await patchJob(jobId, { label: progress.label, progress: progress.overall, progressDetail: progress });

  const plan = await api<ScenePlan>("/api/plan/scenes", {
    method: "POST",
    body: JSON.stringify({
      brief,
      mode: payload.plannerMode || studio.plannerMode,
      shotCount: Number(payload.shotCount) || studio.defaultSceneCount,
      aspectRatio:
        payload.aspectRatio || project.keyframeSettings?.aspectRatio || "16:9",
      systemRules: payload.systemRules ?? studio.systemRules,
      narrativeMode: payload.narrativeMode || studio.narrativeMode,
      narrativeModes: studio.narrativeModes,
      clipDurationSeconds:
        payload.clipDurationSeconds ??
        project.keyframeSettings?.videoDuration ??
        config.defaults.videoDuration,
      continuation: payload.continuation,
    }),
  });

  progress = planProgress("Applying scene plan…", 0.92);
  await patchJob(jobId, { label: progress.label, progress: progress.overall, progressDetail: progress });

  let updated = projectWithPlan(project, plan, apply, brief);
  if (savedOpening) {
    updated = attachOpeningUploadToScene1(updated, savedOpening);
  }

  const { project: saved } = await api<{ project: Project }>(
    `/api/projects/${updated.id}`,
    { method: "PUT", body: JSON.stringify(updated) }
  );
  return saved;
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: tsx media-server/runPipeline.ts <jobId>");
    process.exit(1);
  }

  const job = await api<{
    id: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
  }>(`/api/jobs/${jobId}`);

  let project = await api<Project>(`/api/projects/${job.projectId}`);
  const [assets, studio, config] = await Promise.all([
    api<Asset[]>("/api/assets"),
    api<AppSettings>("/api/settings"),
    api<Config>("/api/config"),
  ]);

  let progress: CreateAllProgress | null = null;

  try {
    if (job.kind === "plan") {
      const saved = await runPlanForProject(jobId, job.projectId, job.payload, studio, config);
      const shotCount = saved.scenes.length;
      progress = {
        active: false,
        phase: "idle",
        sceneIndex: 0,
        currentStep: null,
        label: `Planned ${shotCount} scene${shotCount === 1 ? "" : "s"}.`,
        overall: 1,
        byScene: {},
      };
      await finishJob(jobId, "done", undefined, progress);
      console.error(`[job] ${jobId} plan done (${shotCount} scenes)`);
      return;
    }

    if (job.kind === "yolo") {
      const needsPlan = Boolean(job.payload.needsPlan);
      if (needsPlan && job.payload.brief) {
        project = await runPlanForProject(
          jobId,
          job.projectId,
          {
            ...job.payload,
            apply: "replace",
          },
          studio,
          config
        );
      }
    }

    if (job.kind === "yolo" && job.payload.openingMode === "upload") {
      const scene0 = project.scenes[0];
      const hasKf = scene0?.keyframeId && assets.some((a) => a.id === scene0.keyframeId);
      if (!hasKf) {
        await api(`/api/jobs/${jobId}/waiting`, {
          method: "POST",
          body: JSON.stringify({
            label: "Waiting for opening image upload…",
          }),
        });
        process.exit(0);
      }
    }

    const sceneIds = project.scenes.map((s) => s.id);
    progress = initCreateAll(sceneIds, project.scenes.length);
    await patchJob(jobId, {
      label: "Generating keyframes, videos, bridges…",
      progress: 0,
      progressDetail: progress,
    });

    let projectRef = project;
    let assetsRef = assets;

    const persist = async (updater: (p: Project) => Project) => {
      projectRef = updater(projectRef);
      const { project: saved } = await api<{ project: Project }>(
        `/api/projects/${projectRef.id}`,
        { method: "PUT", body: JSON.stringify(projectRef) }
      );
      projectRef = saved;
    };

    let cancelled = false;
    const cancelPoll = setInterval(() => {
      void isCancelled(jobId).then((c) => {
        cancelled = c;
      });
    }, 2500);

    try {
      await runCreateAllPipeline({
        getProject: () => projectRef,
        getAssets: () => assetsRef,
        getConfig: () => config,
        getEffective: () => effectiveSettings(projectRef, studio, config),
        persistProject: persist,
        refreshAssets: async () => {
          assetsRef = await api<Asset[]>("/api/assets");
          return assetsRef;
        },
        onProgress: (patch) => {
          if (!progress) return;
          progress = mergeCreateAllProgress(progress, patch);
          void patchJob(jobId, {
            progress: progress.overall,
            label: patch.label || progress.label,
            progressDetail: progress,
          }).catch(() => {});
        },
        shouldAbort: () => cancelled,
      });
    } finally {
      clearInterval(cancelPoll);
    }

    if (progress) {
      progress = { ...progress, active: false, phase: "idle", overall: 1 };
    }
    await finishJob(jobId, "done", undefined, progress ?? undefined);
    console.error(`[job] ${jobId} done`);
  } catch (e) {
    const msg = e instanceof CreateAllCancelled ? "Cancelled" : String(e instanceof Error ? e.message : e);
    const cancelled = await isCancelled(jobId);
    if (cancelled || e instanceof CreateAllCancelled) {
      await finishJob(jobId, "cancelled", msg, progress ?? undefined);
    } else {
      await finishJob(jobId, "error", msg, progress ?? undefined);
    }
    console.error(`[job] ${jobId} failed:`, msg);
    process.exit(1);
  }
}

main();