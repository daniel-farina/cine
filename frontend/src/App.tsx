import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInspectorLayout } from "./useInspectorLayout";
import Timeline from "./Timeline";
import HomePage from "./HomePage";
import ProjectPanel from "./ProjectPanel";
import {
  fetchAppSettings,
  fetchAssets,
  fetchConfig,
  fetchProjectsIndex,
  planScenesStream,
  saveProject,
  stitchFilm,
  type ScenePlan,
} from "./api";
import FilmPreviewHero from "./FilmPreviewHero";
import FullscreenFilmPlayer from "./FullscreenFilmPlayer";
import {
  attachOpeningUploadToScene1,
  buildPlanContinuation,
  isStubScene,
  projectWithPlan,
  readOpeningUpload,
  scenesToKeepForAppend,
  yoloNeedsPlan,
  type TimelineApplyMode,
} from "./applyScenePlan";
import { collectSceneVideoIds, resolveStitchedFilmUrl } from "./sceneAssets";
import ImageUploadZone from "./ImageUploadZone";
import {
  ensureYoloOpeningUpload,
  projectWithScene1OpeningMode,
  resolveYoloOpeningMode,
  scene1OpeningBlocker,
  uploadOpeningStill,
} from "./scene1Opening";
import YoloOpeningPicker from "./YoloOpeningPicker";
import type { VideoSource } from "./types";
import SceneInspector from "./SceneInspector";
import SettingsPage from "./SettingsPage";
import { effectiveSettings, normalizeProject } from "./effectiveSettings";
import {
  coerceNarrativeModePreference,
  narrativeModesForSelect,
  normalizeNarrativeModes,
} from "./narrativeModes";
import { SCENE_COUNT_OPTIONS } from "./planningModes";
import type { AppSettings, Asset, Config, Project, ProjectMeta, Scene } from "./types";
import { ReasoningOrb } from "./ReasoningOrb";
import AppBrand from "./AppBrand";
import ThemeToggle from "./ThemeToggle";
import { CreateAllCancelled, runCreateAllPipeline } from "./createAllPipeline";
import {
  initCreateAll,
  mergeCreateAllProgress,
  type CreateAllProgress,
} from "./createAllTypes";
import { PixelProgress } from "./PixelProgress";
import {
  clearPlanningScenes,
  formatPlanStreamError,
  planError,
  planLog,
  planWarn,
  sanitizeFilmBrief,
} from "./planDebug";

function newScene(n: number): Scene {
  return {
    id: crypto.randomUUID(),
    title: `Scene ${n}`,
    imagePrompt: "",
    videoPrompt: "",
    dialogue: "",
    motionPrompt: "Slow subtle dolly in, eye level, 35mm",
    status: "empty",
  };
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [screen, setScreen] = useState<"home" | "project" | "settings">("home");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [reasoningLog, setReasoningLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState("");
  const [sceneCount, setSceneCount] = useState(12);
  const [planApplyMode, setPlanApplyMode] = useState<TimelineApplyMode>("replace");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filmUrl, setFilmUrl] = useState<string | null>(null);
  const [filmOpen, setFilmOpen] = useState(false);
  const [batch, setBatch] = useState<CreateAllProgress | null>(null);
  /** Scene 1 first frame for YOLO when timeline is empty or scene has no videoSource yet. */
  const [yoloOpeningSource, setYoloOpeningSource] = useState<VideoSource>("text");

  const projectRef = useRef<Project | null>(null);
  const assetsRef = useRef<Asset[]>([]);
  const createAllAbortRef = useRef(false);
  const batchRef = useRef<CreateAllProgress | null>(null);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    batchRef.current = batch;
  }, [batch]);

  const yoloOpeningMode = useMemo(
    () => resolveYoloOpeningMode(project, yoloOpeningSource),
    [project, yoloOpeningSource]
  );

  const onYoloOpeningChange = useCallback((mode: VideoSource) => {
    setYoloOpeningSource(mode);
    const p = projectRef.current;
    if (!p?.scenes[0]) return;
    if (mode === "text" || mode === "upload") {
      void persistRef(projectWithScene1OpeningMode(p, mode));
    }
  }, []);

  const assetUrl = useCallback(
    (id?: string | null) => assets.find((a) => a.id === id)?.url,
    [assets]
  );

  const reloadProjects = useCallback(async () => {
    const index = await fetchProjectsIndex();
    setProjectList(index.projects);
    setActiveProjectId(index.activeId);
  }, []);

  const reloadAssets = useCallback(async () => {
    const list = await fetchAssets();
    setAssets(list);
    return list;
  }, []);

  const load = useCallback(async () => {
    const [c, idx, a, studio] = await Promise.all([
      fetchConfig(),
      fetchProjectsIndex(),
      fetchAssets(),
      fetchAppSettings(),
    ]);
    setConfig(c);
    setProjectList(idx.projects);
    setActiveProjectId(idx.activeId);
    setAssets(a);
    const narrativeModes = normalizeNarrativeModes(studio.narrativeModes);
    setAppSettings({
      ...studio,
      narrativeModes,
      narrativeMode: coerceNarrativeModePreference(studio.narrativeMode, narrativeModes),
    });
    setSceneCount(studio.defaultSceneCount ?? 12);
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setStatus(String(e)))
      .finally(() => setReady(true));
  }, [load]);

  const openProject = useCallback(
    (p: Project) => {
      const normalized = normalizeProject(p, appSettings);
      setProject(normalized);
      setActiveProjectId(normalized.id);
      setBrief(normalized.logline || "");
      setScreen("project");
      setStatus("");
      void reloadAssets();
    },
    [appSettings, reloadAssets]
  );

  const goHome = useCallback(() => {
    setScreen("home");
    setProject(null);
    setFilmUrl(null);
    setBusy(false);
    setStatus("");
    void reloadProjects();
    void reloadAssets();
  }, [reloadAssets, reloadProjects]);

  const selected = useMemo(
    () => project?.scenes.find((s) => s.id === project.selectedSceneId) ?? null,
    [project]
  );
  const sceneIndex = project?.scenes.findIndex((s) => s.id === selected?.id) ?? -1;

  const clipVideoIds = useMemo(
    () => (project ? collectSceneVideoIds(project.scenes, assets) : []),
    [project, assets]
  );
  const clipCount = project?.scenes.length ?? 0;
  const canStitchFilm = clipVideoIds.length > 0;
  const hasExistingScenes = clipCount > 0;

  useEffect(() => {
    setPlanApplyMode(project && project.scenes.length > 0 ? "append" : "replace");
  }, [project?.id]);

  const clipVideoKey = clipVideoIds.join(",");
  useEffect(() => {
    if (!project) {
      setFilmUrl(null);
      return;
    }
    setFilmUrl(resolveStitchedFilmUrl(clipVideoIds, assets));
  }, [project?.id, clipVideoKey, assets]);
  const effective = useMemo(
    () => (config ? effectiveSettings(project, appSettings, config) : null),
    [project, appSettings, config]
  );
  const ks = effective?.keyframeSettings;
  const inspectorLayout = useInspectorLayout();

  const persist = async (next: Project) => {
    setProject(next);
    const { project: saved } = await saveProject(next);
    setProject(saved);
    await reloadProjects();
  };

  const patchScene = (id: string, patch: Partial<Scene>) => {
    if (!project) return;
    void persist({
      ...project,
      scenes: project.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };

  const addScene = () => {
    if (!project) return;
    const scene = newScene(project.scenes.length + 1);
    void persist({
      ...project,
      scenes: [...project.scenes, scene],
      selectedSceneId: scene.id,
    });
    setStatus(`Added “${scene.title}”.`);
  };

  const removeScene = (id: string) => {
    if (!project || !project.scenes.length) return;
    const scene = project.scenes.find((s) => s.id === id);
    const onlyScene = project.scenes.length === 1;
    if (
      !confirm(
        onlyScene
          ? `Remove “${scene?.title ?? "this scene"}” and clear the timeline? Keyframes stay in the image library.`
          : `Remove “${scene?.title ?? "this scene"}”? Its keyframes stay in the image library.`
      )
    ) {
      return;
    }
    const scenes = project.scenes.filter((s) => s.id !== id);
    const nextSelected =
      project.selectedSceneId === id
        ? scenes.length
          ? scenes[Math.min(Math.max(sceneIndex, 0), scenes.length - 1)]?.id ?? null
          : null
        : project.selectedSceneId;
    void persist({ ...project, scenes, selectedSceneId: nextSelected });
    setStatus(
      scenes.length
        ? `Removed “${scene?.title ?? "scene"}”.`
        : "Timeline cleared — add a scene or plan from your brief."
    );
  };

  const clearAllScenes = () => {
    if (!project || !project.scenes.length) return;
    if (
      !confirm(
        `Remove all ${project.scenes.length} scenes from the timeline? Keyframes and videos stay in the library.`
      )
    ) {
      return;
    }
    void persist({ ...project, scenes: [], selectedSceneId: null });
    setStatus("Timeline cleared — add a scene or plan from your brief.");
  };

  const runStitchFilm = async () => {
    if (!project || !config) return;
    if (!clipVideoIds.length) {
      setStatus("Add at least one scene video before generating the final movie.");
      return;
    }
    setBusy(true);
    setStatus(
      clipVideoIds.length < clipCount
        ? `Stitching ${clipVideoIds.length} of ${clipCount} clips (missing scenes skipped)…`
        : `Stitching ${clipVideoIds.length} clips into final movie…`
    );
    try {
      const film = await stitchFilm({
        assetIds: clipVideoIds,
        fade: 0.35,
        clipDuration:
          ks?.videoDuration ?? config.defaults.videoDuration ?? 10,
      });
      const list = await reloadAssets();
      setFilmUrl(
        resolveStitchedFilmUrl(clipVideoIds, list) ?? film.url
      );
      setFilmOpen(false);
      setStatus("Final movie ready — preview above the timeline.");
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const timelineNeedsPlan = (p: Project) =>
    p.scenes.length === 0 ||
    p.scenes.every((s) => !(s.visualBeat?.trim() || s.imagePrompt?.trim()));

  const persistRef = async (next: Project) => {
    projectRef.current = next;
    setProject(next);
    const { project: saved } = await saveProject(next);
    projectRef.current = saved;
    setProject(saved);
    await reloadProjects();
    return saved;
  };

  const recoverFromPlanFailure = async () => {
    const cur = projectRef.current;
    if (!cur) return;
    const cleared = clearPlanningScenes(cur);
    projectRef.current = cleared;
    setProject(cleared);
    try {
      await persistRef(cleared);
    } catch (e) {
      planWarn("recover_save_failed", {
        error: String(e instanceof Error ? e.message : e),
      });
    }
  };

  const planBriefForApi = () => {
    const raw = brief.trim();
    const clean = sanitizeFilmBrief(brief);
    if (raw && clean !== raw) {
      planWarn("brief_sanitized", {
        hint: "Removed [Image #N] placeholders from brief before planning",
        rawLen: raw.length,
        cleanLen: clean.length,
      });
    }
    return clean;
  };

  const executePlan = async (
    count: number,
    apply: TimelineApplyMode
  ): Promise<Project> => {
    const proj = projectRef.current;
    const planBrief = planBriefForApi();
    if (!proj || !planBrief || !effective) {
      throw new Error("Enter a film brief first.");
    }

    const keptExisting =
      apply === "append" ? scenesToKeepForAppend(proj.scenes) : [];
    const baseIndex = apply === "append" ? keptExisting.length : 0;
    const continuation =
      apply === "append" && keptExisting.length > 0
        ? buildPlanContinuation(proj)
        : undefined;

    let streamedPlan: ScenePlan | null = null;

    planLog("executePlan_start", { count, apply, mode: effective.plannerMode });

    try {
    const plan = await planScenesStream(
      {
        brief: planBrief,
        shotCount: count,
        aspectRatio: ks?.aspectRatio,
        mode: effective.plannerMode,
        narrativeMode: effective.narrativeMode,
        narrativeModes: effective.narrativeModes,
        clipDurationSeconds: ks?.videoDuration ?? config?.defaults.videoDuration,
        systemRules: effective.systemRules,
        continuation,
      },
      {
        onReasoning: (d) => setReasoningLog((prev) => prev + d),
        onPhase: (m) =>
          setBatch((prev) =>
            prev
              ? { ...prev, label: m, phase: "plan", overall: Math.max(prev.overall, 0.05) }
              : prev
          ),
        onShot: ({ index, label }) => {
          const globalIndex = baseIndex + index;
          setBatch((prev) =>
            prev
              ? {
                  ...prev,
                  label: `Planning scene ${globalIndex + 1}: ${label}`,
                  overall: Math.min(0.12, 0.04 + index * 0.02),
                }
              : prev
          );
          setProject((prev) => {
            if (!prev) return prev;
            const scenes = [...prev.scenes];
            while (scenes.length <= globalIndex) {
              const n = scenes.length + 1;
              scenes.push({ ...newScene(n), title: `Scene ${n}`, status: "generating" });
            }
            scenes[globalIndex] = {
              ...scenes[globalIndex],
              title: label,
              status: "generating",
            };
            const next = { ...prev, scenes };
            projectRef.current = next;
            return next;
          });
        },
        onPlan: (p) => {
          streamedPlan = p;
        },
        onError: (m) => {
          throw new Error(m);
        },
      }
    );

    const finalPlan = plan ?? streamedPlan;
    if (!finalPlan) throw new Error("Planning failed — no scene plan returned.");

    const next = projectWithPlan(proj, finalPlan, apply, planBrief);
    const saved = await persistRef(next);
    if (!saved.scenes.length) throw new Error("Planning produced no scenes.");
    planLog("executePlan_ok", { scenes: saved.scenes.length });
    return saved;
    } catch (e) {
      planError("executePlan_failed", { error: String(e instanceof Error ? e.message : e) });
      await recoverFromPlanFailure();
      throw e;
    }
  };

  const scene1UploadWarn = useMemo(
    () =>
      project && yoloOpeningMode === "upload"
        ? scene1OpeningBlocker(project, assets, yoloOpeningMode)
        : null,
    [project, assets, yoloOpeningMode]
  );

  const handlePlannerOpeningUpload = async (file: File) => {
    const p = projectRef.current;
    if (!p?.scenes[0]) {
      setStatus("Plan scenes first, or run YOLO to create the timeline.");
      return;
    }
    const yoloWaitingUpload =
      batchRef.current?.active && batchRef.current.phase === "upload";
    if (!yoloWaitingUpload) setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      await uploadOpeningStill(p, file, async (next) => {
        await persistRef(next);
      });
      const list = await reloadAssets();
      assetsRef.current = list;
      if (yoloWaitingUpload) {
        setStatus("Opening still uploaded — YOLO will continue automatically…");
      } else {
        setStatus("Opening still ready — click YOLO to run the full pipeline.");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      if (!yoloWaitingUpload) setBusy(false);
    }
  };

  const runYoloGeneratePhase = async (initialAssets: Asset[]) => {
    const p = projectRef.current;
    if (!p?.scenes.length) throw new Error("No scenes to generate.");
    const sceneIds = p.scenes.map((s) => s.id);
    setBatch(initCreateAll(sceneIds, p.scenes.length));
    setStatus("YOLO: generating keyframes, videos, bridges…");

    await runCreateAllPipeline({
      getProject: () => projectRef.current,
      getAssets: () => assetsRef.current,
      getConfig: () => config!,
      getEffective: () => effective!,
      persistProject: async (updater) => {
        const cur = projectRef.current;
        if (!cur) return;
        await persistRef(updater(cur));
      },
      refreshAssets: async () => {
        const list = await reloadAssets();
        assetsRef.current = list;
        return list;
      },
      onProgress: (patch) => {
        setBatch((prev) => (prev ? mergeCreateAllProgress(prev, patch) : prev));
        if (patch.label) setStatus(patch.label);
        if (patch.sceneIndex !== undefined && projectRef.current) {
          const id = projectRef.current.scenes[patch.sceneIndex]?.id;
          if (id) void persistRef({ ...projectRef.current, selectedSceneId: id });
        }
      },
      shouldAbort: () => createAllAbortRef.current,
    });
  };

  const runCreateAll = async () => {
    if (!project || !config || !effective) return;
    if (!project.scenes.length) {
      setStatus("Plan scenes first, or use YOLO to plan and generate.");
      return;
    }
    const mode = resolveYoloOpeningMode(project, yoloOpeningSource);
    if (
      !confirm(
        `Generate keyframes, videos, and bridges for all ${project.scenes.length} scenes?`
      )
    ) {
      return;
    }

    createAllAbortRef.current = false;
    setBusy(true);
    assetsRef.current = assets;

    try {
      let p = projectRef.current ?? project;
      if (mode === "upload") {
        p = projectWithScene1OpeningMode(p, mode);
        await persistRef(p);
        p = projectRef.current ?? p;
      }
      if (mode === "upload") {
        setBatch({
          active: true,
          phase: "upload",
          sceneIndex: 0,
          currentStep: null,
          label: "Choose opening image…",
          overall: 0,
          byScene: {},
        });
        const up = await ensureYoloOpeningUpload({
          project: p,
          assets: assetsRef.current,
          mode,
          getProject: () => projectRef.current,
          persistProject: async (next) => {
            await persistRef(next);
          },
          refreshAssets: reloadAssets,
          onStatus: setStatus,
          promptPicker: true,
          shouldAbort: () => createAllAbortRef.current,
        });
        if (!up.ok) return;
        assetsRef.current = up.assets;
      }
      await runYoloGeneratePhase(assetsRef.current);
      if (!createAllAbortRef.current) {
        setStatus("Create all finished.");
      }
    } catch (e) {
      setStatus(
        e instanceof CreateAllCancelled
          ? "Create all stopped."
          : String(e instanceof Error ? e.message : e)
      );
    } finally {
      setBatch((prev) => (prev ? { ...prev, active: false, phase: "idle" } : null));
      setBusy(false);
      createAllAbortRef.current = false;
      await reloadAssets();
    }
  };

  const runYolo = async () => {
    if (!project || !config?.hasApiKey || !effective) return;
    if (!brief.trim()) {
      setStatus("Enter a film brief — YOLO plans scenes from it when the timeline is empty.");
      return;
    }

    const mode = resolveYoloOpeningMode(project, yoloOpeningSource);
    const uploadOpening = mode === "upload";
    const needsPlan = yoloNeedsPlan(project, sceneCount);
    const savedOpening =
      uploadOpening ? readOpeningUpload(project.scenes) : null;
    const msg = needsPlan
      ? uploadOpening
        ? `YOLO will plan ${sceneCount} scenes, then ask you to choose your opening image, then generate every keyframe, video, and bridge. Continue?`
        : `YOLO will plan ${sceneCount} scenes, then auto-generate every keyframe, video, and bridge. This uses a lot of API time. Continue?`
      : uploadOpening
        ? `YOLO will use your opening image for scene 1, then generate all ${clipCount} clips (keyframes → video → bridge). Continue?`
        : `YOLO will generate all media for ${clipCount} existing scenes (keyframes → video → bridge). Continue?`;
    if (!confirm(msg)) return;

    createAllAbortRef.current = false;
    setBusy(true);
    setReasoningLog("");
    assetsRef.current = assets;
    setBatch({
      active: true,
      phase: needsPlan ? "plan" : uploadOpening ? "upload" : "generate",
      sceneIndex: 0,
      currentStep: null,
      label: needsPlan
        ? `Planning ${sceneCount} scenes…`
        : uploadOpening
          ? "Choose opening image…"
          : "Preparing pipeline…",
      overall: 0,
      byScene: {},
    });

    try {
      if (needsPlan) {
        setStatus(`YOLO: planning ${sceneCount} scenes…`);
        await executePlan(sceneCount, "replace");
        await reloadAssets();
        if (savedOpening && projectRef.current) {
          let restored = attachOpeningUploadToScene1(projectRef.current, savedOpening);
          restored = projectWithScene1OpeningMode(restored, mode);
          await persistRef(restored);
          assetsRef.current = await reloadAssets();
        }
      }

      let p = projectRef.current;
      if (!p?.scenes.length) throw new Error("No scenes to generate.");

      if (uploadOpening) {
        p = projectWithScene1OpeningMode(p, mode);
        await persistRef(p);
        p = projectRef.current ?? p;
        const alreadyHasOpening =
          savedOpening &&
          p.scenes[0]?.keyframeId === savedOpening.keyframeId;
        if (!alreadyHasOpening) {
          setBatch((prev) =>
            prev
              ? { ...prev, phase: "upload", label: "Choose opening image for Scene 1…" }
              : prev
          );
        }
        const up = await ensureYoloOpeningUpload({
          project: p,
          assets: assetsRef.current,
          mode,
          getProject: () => projectRef.current,
          persistProject: async (next) => {
            await persistRef(next);
          },
          refreshAssets: reloadAssets,
          onStatus: setStatus,
          promptPicker: !alreadyHasOpening,
          shouldAbort: () => createAllAbortRef.current,
        });
        if (!up.ok) return;
        assetsRef.current = up.assets;
      }

      await runYoloGeneratePhase(assetsRef.current);

      if (!createAllAbortRef.current) {
        setStatus("YOLO finished — timeline complete.");
      }
    } catch (e) {
      if (!(e instanceof CreateAllCancelled)) {
        await recoverFromPlanFailure();
      }
      setStatus(
        e instanceof CreateAllCancelled
          ? "YOLO stopped."
          : formatPlanStreamError(e)
      );
    } finally {
      setBatch((prev) => (prev ? { ...prev, active: false, phase: "idle" } : null));
      setBusy(false);
      setReasoningLog("");
      createAllAbortRef.current = false;
      await reloadAssets();
    }
  };

  const stopBatch = () => {
    createAllAbortRef.current = true;
    setStatus("Stopping after current step…");
  };

  const runPlan = async (overrides?: {
    count?: number;
    apply?: TimelineApplyMode;
  }) => {
    const planBrief = planBriefForApi();
    if (!project || !planBrief) {
      setStatus("Enter a film brief first.");
      return;
    }
    const count = overrides?.count ?? sceneCount;
    const apply = overrides?.apply ?? planApplyMode;

    if (apply === "replace" && hasExistingScenes && !overrides) {
      const ok = confirm(
        `Replace all ${clipCount} timeline scenes with ${count} new AI-planned scenes?`
      );
      if (!ok) return;
    }

    const keptExisting =
      apply === "append" ? scenesToKeepForAppend(project.scenes) : [];
    const baseIndex = apply === "append" ? keptExisting.length : 0;
    const continuation =
      apply === "append" && keptExisting.length > 0
        ? buildPlanContinuation(project)
        : undefined;

    setBusy(true);
    setReasoningLog("");
    setStatus(
      apply === "append" && hasExistingScenes
        ? `Planning ${count} more scenes after scene ${baseIndex}…`
        : `Planning ${count} scenes…`
    );

    const applyPlan = async (plan: ScenePlan) => {
      const droppedStubs =
        apply === "append"
          ? project.scenes.length -
            scenesToKeepForAppend(project.scenes).length
          : 0;
      const next = projectWithPlan(project, plan, apply, planBrief);
      await persist(next);
      let msg =
        apply === "append"
          ? `Added ${plan.shots.length} scenes (${next.scenes.length} total).`
          : `Created ${plan.shots.length} scenes.`;
      if (droppedStubs > 0) {
        msg += ` Removed ${droppedStubs} empty placeholder scene${droppedStubs > 1 ? "s" : ""}.`;
      }
      setStatus(msg);
    };

    try {
      let applied = false;
      planLog("runPlan_start", { count, apply });
      const plan = await planScenesStream(
        {
          brief: planBrief,
          shotCount: count,
          aspectRatio: ks?.aspectRatio,
          mode: effective?.plannerMode,
          narrativeMode: effective?.narrativeMode,
          narrativeModes: effective?.narrativeModes,
          clipDurationSeconds: ks?.videoDuration ?? config?.defaults.videoDuration,
          systemRules: effective?.systemRules,
          continuation,
        },
        {
          onReasoning: (d) => setReasoningLog((prev) => prev + d),
          onPhase: (m) => setStatus(m),
          onShot: ({ index, label }) => {
            const globalIndex = baseIndex + index;
            setStatus(`Drafting scene ${globalIndex + 1}: ${label}`);
            setProject((prev) => {
              if (!prev) return prev;
              const scenes = [...prev.scenes];
              while (scenes.length <= globalIndex) {
                const n = scenes.length + 1;
                scenes.push({ ...newScene(n), title: `Scene ${n}`, status: "generating" });
              }
              scenes[globalIndex] = {
                ...scenes[globalIndex],
                title: label,
                status: "generating",
              };
              return { ...prev, scenes };
            });
          },
          onPlan: (p) => {
            if (!applied) {
              applied = true;
              void applyPlan(p);
            }
          },
          onError: (m) => {
            throw new Error(m);
          },
        }
      );
      if (plan && !applied) await applyPlan(plan);
    } catch (e) {
      planError("runPlan_failed", { error: String(e instanceof Error ? e.message : e) });
      await recoverFromPlanFailure();
      setStatus(formatPlanStreamError(e));
    } finally {
      setBusy(false);
      setReasoningLog("");
    }
  };

  if (!ready || !config) {
    return <div className="app" style={{ padding: 24 }}>Loading Cine AI…</div>;
  }

  if (screen === "settings") {
    return (
      <div className="app home-shell">
        <header className="topbar topbar-global">
          <AppBrand onClick={() => setScreen(project ? "project" : "home")} />
          <div className="spacer" />
          <ThemeToggle />
        </header>
        <SettingsPage
          config={config}
          project={project}
          onBack={() => setScreen(project ? "project" : "home")}
          onProjectSaved={(p) => {
            const studio = appSettings ?? {
              keyframeSettings: p.keyframeSettings!,
              systemRules: p.systemRules ?? [],
              plannerMode: p.plannerMode ?? "cinematic",
              narrativeMode: p.narrativeMode ?? "auto",
              narrativeModes: [],
              defaultSceneCount: 12,
            };
            setProject(normalizeProject(p, studio));
            void reloadProjects();
          }}
          onStudioSaved={(s) => {
            const modes = normalizeNarrativeModes(s.narrativeModes);
            setAppSettings({
              ...s,
              narrativeModes: modes,
              narrativeMode: coerceNarrativeModePreference(s.narrativeMode, modes),
            });
            setSceneCount(s.defaultSceneCount ?? 12);
          }}
        />
      </div>
    );
  }

  if (screen === "home") {
    return (
      <div className="app home-shell">
        <header className="topbar topbar-global">
          <AppBrand />
          <div className="spacer" />
          <ThemeToggle />
        </header>
        <HomePage
          projects={projectList}
          assets={assets}
          hasApiKey={config.hasApiKey}
          onIndexChange={() => void reloadProjects()}
          onOpenProject={openProject}
          onOpenSettings={() => setScreen("settings")}
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="app" style={{ padding: 24 }}>
        <p className="status">Loading project…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <AppBrand onClick={goHome} />
        <span className="topbar-divider" aria-hidden />
        <button type="button" className="btn btn-nav-home" onClick={goHome}>
          ← Projects
        </button>
        <ProjectPanel
          activeId={activeProjectId}
          projects={projectList}
          onIndexChange={() => void reloadProjects()}
          onProjectLoaded={openProject}
        />
        <div className="spacer" />
        <input
          className="film-title-input"
          value={project.title}
          onChange={(e) => void persist({ ...project, title: e.target.value })}
          aria-label="Project title"
        />
        <button type="button" className="btn" onClick={() => setScreen("settings")}>
          Settings
        </button>
        <button type="button" className="btn" onClick={() => addScene()}>
          + Scene
        </button>
        {filmUrl && !busy && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setFilmOpen(true)}
          >
            Play film
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-film"
          disabled={busy || !canStitchFilm}
          onClick={() => void runStitchFilm()}
          title={
            canStitchFilm
              ? `Stitch ${clipVideoIds.length} clip${clipVideoIds.length === 1 ? "" : "s"} with crossfades`
              : "Generate video on at least one scene first"
          }
        >
          {busy ? "Rendering…" : "Generate final movie"}
        </button>
        <ThemeToggle />
      </header>

      <div
        className={`workspace${inspectorLayout.collapsed ? " inspector-collapsed" : ""}`}
        style={{ gridTemplateColumns: inspectorLayout.gridTemplateColumns }}
      >
        <section className="left">
          <div className="planner">
            <label>Film brief</label>
            <p className="hint planner-brief-hint">
              Saved with this project — edit anytime; used when planning new or additional scenes.
              Pick a narrative mode below (Auto reads keywords like coral, wildlife, reef).
              Each clip is ~{ks?.videoDuration ?? config?.defaults.videoDuration ?? 10}s — re-plan after
              changing duration so beats match clip length.
            </p>
            <textarea
              rows={3}
              value={brief}
              onChange={(e) => {
                setBrief(e.target.value);
                void persist({ ...project, logline: e.target.value });
              }}
              placeholder="Underground racing, Tesla and Elon in a garage with a Cybertruck…"
            />
            {project.storySpine?.trim() && (
              <p className="hint planner-story-spine">
                <strong>Story spine:</strong> {project.storySpine.trim()}
              </p>
            )}
            <div className="planner-row">
              <label className="planner-field">
                Scenes
                <select
                  value={sceneCount}
                  onChange={(e) => setSceneCount(Number(e.target.value))}
                  disabled={busy}
                >
                  {SCENE_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} scene{n > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="planner-field">
                Apply
                <select
                  value={planApplyMode}
                  onChange={(e) =>
                    setPlanApplyMode(e.target.value as TimelineApplyMode)
                  }
                  disabled={busy}
                >
                  <option value="replace">Replace timeline</option>
                  <option value="append">Add to timeline</option>
                </select>
              </label>
              <label className="planner-field">
                Narrative
                <select
                  value={effective?.narrativeMode ?? "auto"}
                  onChange={(e) => {
                    if (!project) return;
                    void persist({
                      ...project,
                      narrativeMode: e.target.value,
                    });
                  }}
                  disabled={busy}
                  title="How the planner treats speech and dialogue"
                >
                  {narrativeModesForSelect(effective?.narrativeModes ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !config.hasApiKey || !brief.trim()}
                onClick={() => void runPlan()}
              >
                {busy
                  ? "Planning…"
                  : planApplyMode === "append" && hasExistingScenes
                    ? `Add ${sceneCount} scenes`
                    : `Plan ${sceneCount} scenes`}
              </button>
            </div>
            {hasExistingScenes && (
              <div className="planner-quick-add">
                <span className="hint">Quick add (same brief, continues story):</span>
                {[1, 2, 4, 6, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={busy || !config.hasApiKey || !brief.trim()}
                    onClick={() => void runPlan({ count: n, apply: "append" })}
                    title={`Append ${n} scene(s) after scene ${clipCount}`}
                  >
                    +{n}
                  </button>
                ))}
              </div>
            )}
            <div className="planner-yolo-opening">
              <YoloOpeningPicker
                selected={yoloOpeningMode}
                disabled={busy}
                onChange={onYoloOpeningChange}
              />
            </div>
            <div className="planner-yolo-row">
              {batch?.active ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-stop-yolo"
                  onClick={stopBatch}
                >
                  Stop
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-yolo"
                    disabled={busy || !config.hasApiKey || !brief.trim()}
                    onClick={() => void runYolo()}
                    title="Plan (if needed), then keyframe → video → bridge for every scene"
                  >
                    YOLO
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={
                      busy || !config.hasApiKey || !hasExistingScenes || !brief.trim()
                    }
                    onClick={() => void runCreateAll()}
                    title="Generate media for scenes already on the timeline"
                  >
                    Create all
                  </button>
                </>
              )}
              <span className="hint">K · V · B dots on each clip show step progress</span>
            </div>
            {yoloOpeningMode === "upload" && (
              <div className="yolo-upload-panel">
                <p className="hint">
                  {batch?.phase === "upload"
                    ? "YOLO is waiting for your opening still — drop an image here or click YOLO again to browse."
                    : scene1UploadWarn
                      ? "Upload Scene 1’s opening image before YOLO (or click YOLO to pick a file when the timeline is ready)."
                      : "Opening still ready for YOLO."}
                </p>
                <ImageUploadZone
                  disabled={busy}
                  busy={busy}
                  hasKeyframe={!scene1UploadWarn}
                  highlight
                  onFile={handlePlannerOpeningUpload}
                />
              </div>
            )}
            {(batch?.active || (batch && batch.overall > 0 && !batch.active)) && (
              <PixelProgress
                value={batch.overall}
                label={batch.label}
                active={batch.active}
              />
            )}
            {busy && batch?.phase === "plan" && (
              <ReasoningOrb reasoning={reasoningLog} active />
            )}
            {busy && !batch && <ReasoningOrb reasoning={reasoningLog} active />}
            {status && (
              <p
                className={`status${
                  status.includes("Created") || status.includes("Added") ? " ok" : ""
                }`}
              >
                {status}
              </p>
            )}
          </div>
          <div className="left-scroll">
            {filmUrl ? (
              <FilmPreviewHero
                url={filmUrl}
                title={project.title}
                clipWithVideo={clipVideoIds.length}
                clipCount={clipCount}
                busy={busy}
                canStitch={canStitchFilm}
                onFullscreen={() => setFilmOpen(true)}
                onRestitch={() => void runStitchFilm()}
              />
            ) : (
              <div className="film-export-bar">
                <span className="film-export-label">Final movie</span>
                <span className="hint">
                  {clipVideoIds.length}/{clipCount} scenes have video
                  {clipVideoIds.length > 0 && clipVideoIds.length < clipCount
                    ? " — only clips with video are included"
                    : ""}
                </span>
              </div>
            )}
            <div className="timeline-wrap">
              <div className="timeline-toolbar">
                <p className="hint">
                  {batch?.active
                    ? "YOLO running — timeline locked"
                    : clipCount
                      ? "Drag clips to reorder · YOLO = plan + full pipeline"
                      : "No scenes yet — add one manually or plan from your film brief"}
                </p>
                {clipCount > 0 && !batch?.active && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={busy}
                    onClick={() => clearAllScenes()}
                  >
                    Clear all scenes
                  </button>
                )}
              </div>
              {clipCount === 0 ? (
                <div className="timeline-empty">
                  <p className="timeline-empty-title">Empty timeline</p>
                  <p className="hint">
                    Plan scenes from your brief, run YOLO, or add clips one at a time.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => addScene()}
                  >
                    Add scene to get started
                  </button>
                </div>
              ) : (
                <Timeline
                  scenes={project.scenes}
                  selectedId={project.selectedSceneId}
                  assets={assets}
                  batch={batch}
                  onSelect={(id) => void persist({ ...project, selectedSceneId: id })}
                  onReorder={(scenes) => void persist({ ...project, scenes })}
                />
              )}
            </div>
          </div>
        </section>

        {inspectorLayout.collapsed ? (
          <aside className="inspector-rail">
            <button
              type="button"
              className="inspector-rail-btn"
              onClick={inspectorLayout.toggleCollapsed}
              title="Expand scene panel"
            >
              Scene
            </button>
          </aside>
        ) : (
          <>
            <div
              className="workspace-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize scene panel"
              onMouseDown={inspectorLayout.onResizeStart}
            />
            <section className="inspector">
              <div className="inspector-chrome">
                <span className="inspector-chrome-title">Scene</span>
                <button
                  type="button"
                  className="btn-icon btn-icon-sm"
                  title="Collapse scene panel"
                  aria-label="Collapse scene panel"
                  onClick={inspectorLayout.toggleCollapsed}
                >
                  ▸
                </button>
              </div>
          {selected && ks && effective ? (
            <>
              <div className="inspector-head">
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{selected.title}</h2>
                  <p className="hint">Scene {sceneIndex + 1} of {clipCount}</p>
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  disabled={busy}
                  title="Remove this scene from the timeline"
                  onClick={() => removeScene(selected.id)}
                >
                  Remove scene
                </button>
              </div>
              <SceneInspector
                project={project}
                config={config}
                scene={selected}
                sceneIndex={sceneIndex}
                assets={assets}
                ks={ks}
                systemRules={effective.systemRules}
                bridgeEditPrompt={effective.bridgeEditPrompt}
                motionRules={effective.motionRules}
                busy={busy}
                setBusy={setBusy}
                status={status}
                setStatus={setStatus}
                onPersist={persist}
                onReloadAssets={reloadAssets}
              />
            </>
          ) : clipCount === 0 ? (
            <div className="inspector-empty">
              <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>No scenes</h2>
              <p className="hint">
                Write a film brief and click Plan, use YOLO, or add a scene manually.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => addScene()}
              >
                Add scene to get started
              </button>
            </div>
          ) : (
            <p className="hint inspector-placeholder">Select a scene on the timeline</p>
          )}
            </section>
          </>
        )}
      </div>

      {filmOpen && filmUrl && (
        <FullscreenFilmPlayer
          url={filmUrl}
          title={project.title}
          onClose={() => setFilmOpen(false)}
        />
      )}
    </div>
  );
}