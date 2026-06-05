/**
 * Server-side job runner — executes create_all / yolo generate using the same pipeline as the UI.
 * Usage: npx tsx media-server/runPipeline.ts <jobId>
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
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
const { initCreateAll, mergeCreateAllProgress } = await import(
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

async function patchJob(jobId: string, patch: {
  progress?: number;
  label?: string;
  progressDetail?: CreateAllProgress;
}) {
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

async function runPlan(projectId: string, payload: Record<string, unknown>) {
  const plan = await api<{ lookBible: string; storySpine?: string; shots: unknown[] }>(
    "/api/plan/scenes",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  const project = await api<Project>(`/api/projects/${projectId}`);
  const shots = plan.shots as Array<{
    label: string;
    shotKind?: string;
    scenePrompt: string;
    cameraPrompt: string;
    actionPrompt?: string;
    dialogue?: string;
    visualBeat?: string;
    videoPrompt?: string;
    storyBeat?: string;
    continuityIn?: string;
    endState?: string;
  }>;
  const scenes = shots.map((s, i) => ({
    id: crypto.randomUUID(),
    title: s.label || `Scene ${i + 1}`,
    imagePrompt: s.scenePrompt || "",
    visualBeat: s.visualBeat || s.scenePrompt || "",
    videoPrompt: s.videoPrompt || s.actionPrompt || "",
    dialogue: s.dialogue || "",
    motionPrompt: s.cameraPrompt || "Slow subtle dolly in",
    shotKind: s.shotKind,
    storyBeat: s.storyBeat,
    continuityIn: s.continuityIn,
    endState: s.endState,
    status: "empty" as const,
  }));
  const firstId = scenes[0]?.id ?? null;
  const updated: Project = {
    ...project,
    lookBible: plan.lookBible,
    storySpine: plan.storySpine,
    scenes,
    selectedSceneId: firstId,
  };
  await api<{ project: Project }>(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify(updated),
  });
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
    if (job.kind === "yolo" || job.kind === "plan") {
      const needsPlan = Boolean(job.payload.needsPlan);
      if (needsPlan && job.payload.brief) {
        await patchJob(jobId, { label: "Planning scenes…", progress: 0.02 });
        await runPlan(job.projectId, {
          brief: job.payload.brief,
          mode: job.payload.plannerMode || studio.plannerMode,
          shotCount: job.payload.sceneCount || studio.defaultSceneCount,
          aspectRatio: project.keyframeSettings?.aspectRatio || "16:9",
          systemRules: studio.systemRules,
          narrativeMode: job.payload.narrativeMode || studio.narrativeMode,
          narrativeModes: studio.narrativeModes,
          clipDurationSeconds:
            project.keyframeSettings?.videoDuration ?? config.defaults.videoDuration,
        });
        project = await api<Project>(`/api/projects/${job.projectId}`);
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
    await patchJob(jobId, { label: "Generating keyframes, videos, bridges…", progress: 0, progressDetail: progress });

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