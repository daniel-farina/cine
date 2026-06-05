import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAssets,
  generateImage,
  generateVideo,
  stitchFilm,
  uploadKeyframeImage,
} from "./api";
import { effectiveSettings } from "./effectiveSettings";
import { normalizeKeyframeSettings, VIDEO_RESOLUTIONS } from "./keyframeSettings";
import ApiPayloadModal from "./ApiPayloadModal";
import ImageUploadZone from "./ImageUploadZone";
import FullscreenFilmPlayer from "./FullscreenFilmPlayer";
import QuickBuilderProcessing from "./QuickBuilderProcessing";
import { isVideoApiPayload, resolveVideoApiPayload, type VideoApiPayload } from "./videoApiPayload";
import { buildKeyframePrompt, formatMotionPrompt } from "./prompts";
import {
  createClipProgressTicker,
  type ClipJob,
} from "./quickBuilderClipJob";
import {
  estimateMs,
  hydrateClipsFromAssets,
  loadPromptHistory,
  loadQuickBuilderDraft,
  loadQuickBuilderSession,
  loadQuickBuilderSettings,
  rememberPrompt,
  promptPreview,
  recordTiming,
  resolveUploadedStill,
  saveQuickBuilderDraft,
  saveQuickBuilderSession,
  saveQuickBuilderSettings,
  type PromptHistoryEntry,
  type QuickBuilderOutputTarget,
  type QuickClip,
} from "./quickBuilderStorage";
import { isAbortError } from "./quickBuilderAbort";
import { useTimedProgress } from "./useTimedProgress";
import type { AppSettings, Asset, Config, KeyframeSettings } from "./types";

const QUICK_SCENE_ID = "quick-builder";
const DURATION_OPTIONS = [5, 8, 10, 12, 15];

type Mode = "text" | "image";

type Props = {
  config: Config;
  appSettings: AppSettings | null;
  hasApiKey: boolean;
  onBack: () => void;
  onAssetsChange?: () => void | Promise<void>;
};

function nextClipLabel(clips: QuickClip[]): string {
  return `Clip ${clips.length + 1}`;
}

export default function QuickBuilderPage({
  config,
  appSettings,
  hasApiKey,
  onBack,
  onAssetsChange,
}: Props) {
  const effective = useMemo(
    () => effectiveSettings(null, appSettings, config),
    [appSettings, config]
  );

  const [qbSettings, setQbSettings] = useState<KeyframeSettings>(() =>
    loadQuickBuilderSettings(appSettings?.keyframeSettings, config)
  );

  const draftInit = useMemo(() => loadQuickBuilderDraft(), []);
  const savedSession = useMemo(() => loadQuickBuilderSession(), []);

  const [mode, setMode] = useState<Mode>(draftInit?.mode ?? "text");
  const [outputTarget, setOutputTarget] = useState<QuickBuilderOutputTarget>(
    draftInit?.outputTarget ?? "still-and-video"
  );
  const [stillPrompt, setStillPrompt] = useState(draftInit?.stillPrompt ?? "");
  const [motionPrompt, setMotionPrompt] = useState(
    draftInit?.motionPrompt ?? "Slow subtle dolly in, eye level, 35mm"
  );
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>(() =>
    loadPromptHistory()
  );
  const [showPromptHistory, setShowPromptHistory] = useState(false);

  const [uploadedKeyframeId, setUploadedKeyframeId] = useState<string | null>(
    () => savedSession?.uploadedKeyframeId ?? null
  );
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const [clips, setClips] = useState<QuickClip[]>(() => savedSession?.clips ?? []);
  const [clipJobs, setClipJobs] = useState<Record<string, ClipJob>>({});
  const [stitchOrder, setStitchOrder] = useState<string[]>(() => savedSession?.stitchOrder ?? []);
  const [stitchBusy, setStitchBusy] = useState(false);
  const [status, setStatus] = useState(() => savedSession?.status ?? "");
  const [stitchedUrl, setStitchedUrl] = useState<string | null>(
    () => savedSession?.stitchedUrl ?? null
  );
  const [filmOpen, setFilmOpen] = useState(false);
  const [previewClipId, setPreviewClipId] = useState<string | null>(
    () => savedSession?.previewClipId ?? null
  );
  const [assets, setAssets] = useState<Asset[]>([]);
  const [payloadModal, setPayloadModal] = useState<{
    title: string;
    payload: VideoApiPayload;
  } | null>(null);

  const stitchTimed = useTimedProgress();
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortByClipId = useRef(new Map<string, AbortController>());
  const stopTickerByClipId = useRef(new Map<string, () => void>());

  const qbSettingsRef = useRef(qbSettings);
  const effectiveRef = useRef(effective);
  const configRef = useRef(config);
  const clipsRef = useRef(clips);
  const onAssetsChangeRef = useRef(onAssetsChange);

  qbSettingsRef.current = qbSettings;
  effectiveRef.current = effective;
  configRef.current = config;
  clipsRef.current = clips;
  onAssetsChangeRef.current = onAssetsChange;

  const generatingCount = clips.filter((c) => c.status === "generating").length;

  const previewClip = clips.find((c) => c.id === previewClipId) ?? clips[0] ?? null;
  const previewJob = previewClipId ? clipJobs[previewClipId] : undefined;
  const showProcessingOverlay =
    previewClip?.status === "generating" && Boolean(previewJob?.phase);

  const setClipJob = useCallback((clipId: string, job: ClipJob | null) => {
    setClipJobs((prev) => {
      if (!job) {
        const next = { ...prev };
        delete next[clipId];
        return next;
      }
      return { ...prev, [clipId]: job };
    });
  }, []);

  const stopClipTicker = useCallback((clipId: string) => {
    stopTickerByClipId.current.get(clipId)?.();
    stopTickerByClipId.current.delete(clipId);
  }, []);

  const startClipTicker = useCallback(
    (clipId: string, phase: ClipJob["phase"], estimate: number, label: string, keyframeUrl: string | null) => {
      stopClipTicker(clipId);
      setClipJob(clipId, { phase, progress: 0, label, keyframeUrl });
      const stop = createClipProgressTicker(estimate, (progress) => {
        setClipJobs((prev) => {
          const cur = prev[clipId];
          if (!cur) return prev;
          return { ...prev, [clipId]: { ...cur, progress } };
        });
      });
      stopTickerByClipId.current.set(clipId, stop);
    },
    [setClipJob, stopClipTicker]
  );

  const patchClip = useCallback((id: string, patch: Partial<QuickClip>) => {
    setClips((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const patchSettings = (partial: Partial<KeyframeSettings>) => {
    setQbSettings((prev) => {
      const next = normalizeKeyframeSettings({ ...prev, ...partial }, config);
      saveQuickBuilderSettings(next);
      return next;
    });
  };

  useEffect(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveQuickBuilderDraft({ mode, outputTarget, stillPrompt, motionPrompt });
    }, 400);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [mode, outputTarget, stillPrompt, motionPrompt]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchAssets();
        if (cancelled) return;
        setAssets(list);
        setClips((prev) => hydrateClipsFromAssets(prev, list));
        const upload = resolveUploadedStill(
          savedSession?.uploadedKeyframeId ?? uploadedKeyframeId,
          assets
        );
        if (upload) {
          setUploadedKeyframeId(upload.id);
          setUploadedPreviewUrl(upload.url);
        }
        if (savedSession?.stitchedUrl) {
          setStitchedUrl(savedSession.stitchedUrl);
        }
      } catch {
        /* keep stored URLs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      saveQuickBuilderSession({
        clips,
        stitchOrder,
        stitchedUrl,
        previewClipId,
        uploadedKeyframeId,
        status,
      });
    }, 300);
    return () => {
      if (sessionTimer.current) clearTimeout(sessionTimer.current);
    };
  }, [clips, stitchOrder, stitchedUrl, previewClipId, uploadedKeyframeId, status]);

  const openClipPayload = useCallback(
    (clip: QuickClip) => {
      if (!clip.videoId) return;
      const video = assets.find((a) => a.id === clip.videoId);
      const payload =
        clip.apiPayload && isVideoApiPayload(clip.apiPayload)
          ? clip.apiPayload
          : resolveVideoApiPayload(video, assets);
      if (!payload) return;
      setPayloadModal({ title: `${clip.label} — video API`, payload });
    },
    [assets]
  );

  const applyPromptEntry = (entry: PromptHistoryEntry) => {
    setMode(entry.mode);
    setStillPrompt(entry.stillPrompt ?? "");
    setMotionPrompt(entry.motionPrompt);
    setShowPromptHistory(false);
    setStatus("Prompt loaded from history.");
  };

  const toggleStitch = (clipId: string) => {
    setStitchOrder((prev) => {
      if (prev.includes(clipId)) return prev.filter((id) => id !== clipId);
      return [...prev, clipId];
    });
  };

  const moveStitch = (clipId: string, dir: -1 | 1) => {
    setStitchOrder((prev) => {
      const i = prev.indexOf(clipId);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const cancelClipJob = useCallback(
    (clipId: string) => {
      abortByClipId.current.get(clipId)?.abort();
      abortByClipId.current.delete(clipId);
      stopClipTicker(clipId);
      setClipJob(clipId, null);
      setClips((list) =>
        list.map((c) =>
          c.id === clipId && c.status === "generating"
            ? { ...c, status: "error" as const, error: "Cancelled" }
            : c
        )
      );
      setStatus("Cancelled.");
    },
    [setClipJob, stopClipTicker]
  );

  const cancelPreviewClipJob = useCallback(() => {
    if (previewClipId) cancelClipJob(previewClipId);
  }, [previewClipId, cancelClipJob]);

  const finishStillOnly = useCallback(
    (clipId: string, label: string, keyframeId: string, keyframeUrl: string, motion: string) => {
      stopClipTicker(clipId);
      setClipJob(clipId, null);
      patchClip(clipId, {
        status: "still",
        keyframeId,
        keyframeUrl,
        prompt: motion,
      });
      setStatus(`${label} still ready — generate video when you like.`);
    },
    [patchClip, setClipJob, stopClipTicker]
  );

  const executeClipJob = useCallback(
    async (opts: {
      clipId: string;
      label: string;
      genMode: Mode;
      visual: string;
      motion: string;
      outputTarget: QuickBuilderOutputTarget;
      videoOnly?: boolean;
      sourceKeyframeId?: string;
      sourceKeyframeUrl?: string | null;
    }) => {
      const { clipId, label, genMode, visual, motion, outputTarget, videoOnly } = opts;
      const ks = qbSettingsRef.current;
      const eff = effectiveRef.current;
      const cfg = configRef.current;
      const wantVideo = videoOnly || outputTarget === "still-and-video";

      abortByClipId.current.get(clipId)?.abort();
      const ac = new AbortController();
      abortByClipId.current.set(clipId, ac);
      const { signal } = ac;

      let keyframeId = opts.sourceKeyframeId;
      let keyframeUrl = opts.sourceKeyframeUrl ?? undefined;

      try {
        if (!videoOnly) {
          if (genMode === "text") {
            if (!visual) throw new Error("Enter a visual prompt for the opening still.");
            const imgEstimate = estimateMs("imageMs");
            startClipTicker(
              clipId,
              "image",
              imgEstimate,
              `Opening still · ${ks.imageResolution}`,
              null
            );
            const imgStart = Date.now();
            const still = await generateImage(
              {
                prompt: buildKeyframePrompt(visual, { systemRules: eff.systemRules }),
                sceneId: QUICK_SCENE_ID,
                label,
                aspect_ratio: ks.aspectRatio,
                resolution: ks.imageResolution,
                model: ks.imageModel,
              },
              { signal }
            );
            if (signal.aborted) return;
            recordTiming("imageMs", Date.now() - imgStart);
            keyframeId = still.id;
            keyframeUrl = still.url;
            patchClip(clipId, { keyframeId, keyframeUrl });
            setClipJob(clipId, {
              phase: "image",
              progress: 1,
              label: `Opening still · ${ks.imageResolution}`,
              keyframeUrl: still.url,
            });
          } else if (!keyframeId) {
            throw new Error("Upload an image first, or switch to text-to-video.");
          }

          if (!wantVideo) {
            finishStillOnly(clipId, label, keyframeId!, keyframeUrl!, motion);
            setPromptHistory(
              rememberPrompt({
                mode: genMode,
                stillPrompt: visual || undefined,
                motionPrompt: motionPrompt.trim(),
              })
            );
            const list = await fetchAssets();
            setAssets(list);
            await onAssetsChangeRef.current?.();
            return;
          }
        } else {
          const clip = clipsRef.current.find((c) => c.id === clipId);
          keyframeId = clip?.keyframeId ?? keyframeId;
          keyframeUrl = clip?.keyframeUrl ?? keyframeUrl;
          if (!keyframeId) throw new Error("No still found for this clip.");
          patchClip(clipId, { status: "generating", error: undefined });
        }

        if (signal.aborted) return;

        const videoEstimate = estimateMs("videoMs");
        startClipTicker(
          clipId,
          "video",
          videoEstimate,
          `Video · ${ks.videoResolution}`,
          keyframeUrl ?? null
        );
        const videoStart = Date.now();
        const video = await generateVideo(
          {
            prompt: motion,
            sourceImageId: keyframeId!,
            sceneId: QUICK_SCENE_ID,
            duration: ks.videoDuration ?? cfg.defaults.videoDuration,
            aspect_ratio: ks.aspectRatio,
            resolution: ks.videoResolution,
          },
          { signal }
        );
        if (signal.aborted) return;
        recordTiming("videoMs", Date.now() - videoStart);
        stopClipTicker(clipId);
        setClipJob(clipId, null);

        patchClip(clipId, {
          status: "ready",
          videoId: video.id,
          videoUrl: video.url,
          keyframeId,
          keyframeUrl,
          prompt: motion,
          apiPayload: video.apiPayload,
        });
        setStitchOrder((prev) => (prev.includes(clipId) ? prev : [...prev, clipId]));
        setPromptHistory(
          rememberPrompt({
            mode: genMode,
            stillPrompt: visual || undefined,
            motionPrompt: motionPrompt.trim(),
          })
        );
        const n = clipsRef.current.filter((c) => c.status === "generating").length;
        setStatus(`${label} ready.${n > 1 ? ` (${n - 1} still generating)` : ""}`);
        const list = await fetchAssets();
        setAssets(list);
        await onAssetsChangeRef.current?.();
      } catch (e) {
        stopClipTicker(clipId);
        setClipJob(clipId, null);
        if (isAbortError(e)) {
          patchClip(clipId, {
            status: "error",
            error: "Cancelled",
            keyframeId,
            keyframeUrl,
          });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          patchClip(clipId, { status: "error", error: msg, keyframeId, keyframeUrl });
          setStatus(msg);
        }
      } finally {
        abortByClipId.current.delete(clipId);
      }
    },
    [finishStillOnly, motionPrompt, patchClip, setClipJob, startClipTicker, stopClipTicker]
  );

  const runVideoForClip = useCallback(
    (clip: QuickClip) => {
      if (!hasApiKey) {
        setStatus("Add XAI_API_KEY in .env to generate media.");
        return;
      }
      if (!clip.keyframeId) {
        setStatus("This clip has no still to animate.");
        return;
      }
      const motion = formatMotionPrompt(
        clip.prompt || motionPrompt,
        effectiveRef.current.motionRules
      );
      setPreviewClipId(clip.id);
      patchClip(clip.id, { status: "generating", error: undefined });
      setStatus(`Generating video for ${clip.label}…`);
      void executeClipJob({
        clipId: clip.id,
        label: clip.label,
        genMode: clip.mode,
        visual: clip.stillPrompt ?? "",
        motion,
        outputTarget: "still-and-video",
        videoOnly: true,
        sourceKeyframeId: clip.keyframeId,
        sourceKeyframeUrl: clip.keyframeUrl ?? null,
      });
    },
    [executeClipJob, hasApiKey, motionPrompt, patchClip]
  );

  const runGenerate = () => {
    if (!hasApiKey) {
      setStatus("Add XAI_API_KEY in .env to generate media.");
      return;
    }

    const visual = stillPrompt.trim();
    if (mode === "text" && !visual) {
      setStatus("Enter a visual prompt for the opening still.");
      return;
    }
    if (mode === "image" && !uploadedKeyframeId) {
      setStatus("Upload an image first, or switch to text-to-video.");
      return;
    }

    const motion = formatMotionPrompt(motionPrompt, effective.motionRules);
    const clipId = crypto.randomUUID();
    const label = nextClipLabel(clips);

    if (mode === "image" && outputTarget === "still-only") {
      setClips((list) => [
        {
          id: clipId,
          label,
          mode,
          status: "still",
          prompt: motion,
          keyframeId: uploadedKeyframeId ?? undefined,
          keyframeUrl: uploadedPreviewUrl ?? undefined,
          sourceKeyframeId: uploadedKeyframeId ?? undefined,
          sourceKeyframeUrl: uploadedPreviewUrl ?? undefined,
          createdAt: new Date().toISOString(),
        },
        ...list,
      ]);
      setPreviewClipId(clipId);
      setStatus(`${label} still saved — generate video when ready.`);
      return;
    }

    setClips((list) => [
      {
        id: clipId,
        label,
        mode,
        status: "generating",
        prompt: motion,
        stillPrompt: visual || undefined,
        sourceKeyframeId: mode === "image" ? uploadedKeyframeId ?? undefined : undefined,
        sourceKeyframeUrl: mode === "image" ? uploadedPreviewUrl ?? undefined : undefined,
        createdAt: new Date().toISOString(),
      },
      ...list,
    ]);
    setPreviewClipId(clipId);
    setStatus(
      generatingCount > 0
        ? `Queued ${label} (${generatingCount + 1} running)…`
        : outputTarget === "still-only"
          ? `Generating still for ${label}…`
          : `Started ${label}…`
    );

    void executeClipJob({
      clipId,
      label,
      genMode: mode,
      visual,
      motion,
      outputTarget,
      sourceKeyframeId: mode === "image" ? uploadedKeyframeId ?? undefined : undefined,
      sourceKeyframeUrl: mode === "image" ? uploadedPreviewUrl : null,
    });
  };

  const handleUpload = useCallback(async (file: File) => {
    setUploadBusy(true);
    setStatus("Uploading still…");
    try {
      const asset = await uploadKeyframeImage(file, {
        sceneId: QUICK_SCENE_ID,
        label: file.name,
      });
      setUploadedKeyframeId(asset.id);
      setUploadedPreviewUrl(asset.url);
      setStatus("Still ready — queue more clips or generate.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  }, []);

  const runStitch = async () => {
    const ids = stitchOrder
      .map((id) => clips.find((c) => c.id === id))
      .filter((c): c is QuickClip => Boolean(c?.videoId && c.status === "ready"))
      .map((c) => c.videoId!);

    if (!ids.length) {
      setStatus("Select at least one finished clip to stitch.");
      return;
    }

    setStitchBusy(true);
    const ac = new AbortController();
    const { signal } = ac;
    const stitchEstimate = estimateMs("stitchMs");
    stitchTimed.start(
      "stitch",
      stitchEstimate * Math.max(1, ids.length * 0.65),
      ids.length === 1 ? "Exporting clip" : `Stitching ${ids.length} clips`
    );
    setStatus(ids.length === 1 ? "Preparing export…" : `Stitching ${ids.length} clips…`);
    const stitchStart = Date.now();
    try {
      const film = await stitchFilm(
        {
          assetIds: ids,
          clipDuration: qbSettings.videoDuration ?? config.defaults.videoDuration,
        },
        { signal }
      );
      if (signal.aborted) return;
      recordTiming("stitchMs", Date.now() - stitchStart);
      stitchTimed.finish();
      setStitchedUrl(film.url);
      setStatus(
        ids.length === 1 ? "Clip exported." : `Stitched ${ids.length} clips into one video.`
      );
      await onAssetsChange?.();
    } catch (e) {
      stitchTimed.stop();
      setStatus(isAbortError(e) ? "Cancelled." : e instanceof Error ? e.message : String(e));
    } finally {
      setStitchBusy(false);
    }
  };

  const removeClip = (id: string) => {
    if (clips.find((c) => c.id === id)?.status === "generating") {
      cancelClipJob(id);
    }
    setClips((list) => list.filter((c) => c.id !== id));
    setStitchOrder((prev) => prev.filter((x) => x !== id));
    if (previewClipId === id) setPreviewClipId(null);
  };

  const readyCount = clips.filter((c) => c.status === "ready").length;
  const stillCount = clips.filter((c) => c.status === "still").length;
  const videoDurations =
    config.defaults.videoDuration && !DURATION_OPTIONS.includes(config.defaults.videoDuration)
      ? [...new Set([...DURATION_OPTIONS, config.defaults.videoDuration])].sort((a, b) => a - b)
      : DURATION_OPTIONS;

  const previewStillUrl =
    previewJob?.keyframeUrl ??
    previewClip?.keyframeUrl ??
    previewClip?.sourceKeyframeUrl ??
    null;

  const showStitchOverlay = stitchBusy && stitchTimed.active && stitchTimed.phase === "stitch";

  return (
    <div className="quick-builder">
      <header className="quick-builder-header">
        <div>
          <h1>Quick Builder</h1>
          <p className="hint">
            Queue multiple clips in parallel — click any in the shelf to watch its live progress
            and opening still.
          </p>
        </div>
        <button type="button" className="btn" onClick={onBack}>
          ← Projects
        </button>
      </header>

      {!hasApiKey && (
        <p className="chip warn quick-builder-warn">Add XAI_API_KEY in .env to generate media.</p>
      )}

      {generatingCount > 0 && (
        <p className="chip quick-builder-running">{generatingCount} generating…</p>
      )}

      <div className="quick-builder-layout">
        <section className="quick-builder-compose panel">
          <div className="quick-builder-mode">
            <button
              type="button"
              className={`settings-scope-btn${mode === "text" ? " active" : ""}`}
              onClick={() => setMode("text")}
            >
              Text → video
            </button>
            <button
              type="button"
              className={`settings-scope-btn${mode === "image" ? " active" : ""}`}
              onClick={() => setMode("image")}
            >
              Image → video
            </button>
          </div>

          {mode === "text" ? (
            <label className="quick-builder-field">
              Visual prompt (opening still)
              <textarea
                rows={3}
                value={stillPrompt}
                onChange={(e) => setStillPrompt(e.target.value)}
                placeholder="A barn owl perched on a mossy branch at dawn, cinematic 35mm…"
              />
            </label>
          ) : (
            <div className="quick-builder-upload">
              <ImageUploadZone
                compact
                busy={uploadBusy}
                hasKeyframe={!!uploadedKeyframeId}
                highlight
                onFile={handleUpload}
              />
              {uploadedPreviewUrl && (
                <img
                  className="quick-builder-upload-thumb"
                  src={uploadedPreviewUrl}
                  alt="Uploaded still"
                />
              )}
            </div>
          )}

          <div className="quick-builder-output-target">
            <span className="quick-builder-output-label">Output</span>
            <button
              type="button"
              className={`settings-scope-btn${outputTarget === "still-only" ? " active" : ""}`}
              onClick={() => setOutputTarget("still-only")}
            >
              Still only
            </button>
            <button
              type="button"
              className={`settings-scope-btn${outputTarget === "still-and-video" ? " active" : ""}`}
              onClick={() => setOutputTarget("still-and-video")}
            >
              Still + video
            </button>
          </div>
          <p className="hint quick-builder-output-hint">
            {outputTarget === "still-only"
              ? "Generate the opening image first; review it, then run video from the clip when ready."
              : "Generate opening still and video in one step."}
          </p>

          <label className="quick-builder-field">
            Motion prompt
            {outputTarget === "still-and-video" && (
              <> (~{qbSettings.videoDuration ?? config.defaults.videoDuration}s clip)</>
            )}
            <textarea
              rows={2}
              value={motionPrompt}
              onChange={(e) => setMotionPrompt(e.target.value)}
              placeholder="Slow push-in, shallow depth of field, natural ambient sound…"
              disabled={outputTarget === "still-only" && mode === "image"}
            />
          </label>
          {outputTarget === "still-only" && mode === "image" && (
            <p className="hint">Motion prompt applies when you generate video later.</p>
          )}

          {promptHistory.length > 0 && (
            <div className="quick-builder-prompt-history">
              <button
                type="button"
                className="quick-builder-prompt-history-toggle"
                onClick={() => setShowPromptHistory((s) => !s)}
                aria-expanded={showPromptHistory}
              >
                Recent prompts ({promptHistory.length})
                <span aria-hidden>{showPromptHistory ? " ▾" : " ▸"}</span>
              </button>
              {showPromptHistory && (
                <ul className="quick-builder-prompt-list">
                  {promptHistory.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="quick-builder-prompt-chip"
                        onClick={() => applyPromptEntry(entry)}
                        title={[entry.stillPrompt, entry.motionPrompt]
                          .filter(Boolean)
                          .join("\n\n")}
                      >
                        <span className="quick-builder-prompt-chip-mode">
                          {entry.mode === "text" ? "Text" : "Image"}
                        </span>
                        <span className="quick-builder-prompt-chip-text">
                          {promptPreview(entry)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <details className="quick-builder-settings-panel">
            <summary>Generation settings</summary>
            <div className="quick-builder-settings">
              <label>
                Aspect
                <select
                  value={qbSettings.aspectRatio}
                  onChange={(e) => patchSettings({ aspectRatio: e.target.value })}
                >
                  {config.aspectRatios.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Duration
                <select
                  value={qbSettings.videoDuration ?? config.defaults.videoDuration}
                  onChange={(e) => patchSettings({ videoDuration: Number(e.target.value) })}
                >
                  {videoDurations.map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Video
                <select
                  value={qbSettings.videoResolution ?? "720p"}
                  onChange={(e) => patchSettings({ videoResolution: e.target.value })}
                >
                  {(config.videoResolutions?.length
                    ? config.videoResolutions
                    : VIDEO_RESOLUTIONS
                  ).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {mode === "text" && (
              <div className="quick-builder-settings quick-builder-settings-image">
                <label>
                  Image model
                  <select
                    value={qbSettings.imageModel}
                    onChange={(e) => patchSettings({ imageModel: e.target.value })}
                  >
                    {config.imageModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Still res
                  <select
                    value={qbSettings.imageResolution}
                    onChange={(e) => patchSettings({ imageResolution: e.target.value })}
                  >
                    {config.imageResolutions.map((r) => (
                      <option key={r} value={r}>
                        {r.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <p className="hint quick-builder-settings-hint">
              Saved for Quick Builder only. Progress bars learn from your last run times.
            </p>
          </details>

          <button
            type="button"
            className="btn btn-primary quick-builder-generate"
            disabled={!hasApiKey}
            onClick={runGenerate}
          >
            {generatingCount > 0
              ? outputTarget === "still-only"
                ? "Generate another still"
                : "Generate another clip"
              : outputTarget === "still-only"
                ? mode === "image"
                  ? "Save still to shelf"
                  : "Generate still"
                : "Generate clip"}
          </button>

          {status && <p className="status quick-builder-status">{status}</p>}
        </section>

        <section className="quick-builder-main">
          <div className="quick-builder-preview panel">
            <div className="quick-builder-preview-head">
              <span className="quick-builder-preview-title">Preview</span>
              {previewClip && (
                <span className="hint">
                  {previewClip.label}
                  {previewClip.status === "generating" && previewJob
                    ? ` · ${previewJob.label}`
                    : ""}
                </span>
              )}
              {previewClip?.status === "still" && previewClip.keyframeId && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!hasApiKey}
                  onClick={() => runVideoForClip(previewClip)}
                >
                  Generate video
                </button>
              )}
              {previewClip?.videoId && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => openClipPayload(previewClip)}
                >
                  API payload
                </button>
              )}
            </div>
            <div
              className={`quick-builder-preview-stage${showProcessingOverlay || showStitchOverlay ? " is-processing" : ""}`}
            >
              {showStitchOverlay && (
                <QuickBuilderProcessing
                  active={stitchTimed.active}
                  phase={stitchTimed.phase}
                  progress={stitchTimed.progress}
                  label={stitchTimed.label}
                  keyframeUrl={null}
                />
              )}
              {showProcessingOverlay && previewJob && (
                <QuickBuilderProcessing
                  active
                  phase={previewJob.phase}
                  progress={previewJob.progress}
                  label={previewJob.label}
                  keyframeUrl={previewStillUrl}
                  onStop={cancelPreviewClipJob}
                />
              )}
              {!showProcessingOverlay &&
                !showStitchOverlay &&
                previewClip?.videoUrl &&
                previewClip.status === "ready" && (
                  <video
                    key={previewClip.videoId}
                    src={previewClip.videoUrl}
                    controls
                    playsInline
                    className="quick-builder-preview-video"
                  />
                )}
              {!showProcessingOverlay &&
                !showStitchOverlay &&
                !previewClip?.videoUrl &&
                previewClip?.keyframeUrl && (
                  <>
                    <img
                      src={previewClip.keyframeUrl}
                      alt=""
                      className="quick-builder-preview-still"
                    />
                    {previewClip.status === "still" && (
                      <p className="quick-builder-preview-banner">Still only — no video yet</p>
                    )}
                    {previewClip.status === "error" && (
                      <p className="quick-builder-preview-banner error">{previewClip.error}</p>
                    )}
                  </>
                )}
              {!showProcessingOverlay &&
                !showStitchOverlay &&
                previewClip?.status === "error" &&
                !previewClip.keyframeUrl && (
                  <div className="quick-builder-preview-empty error">{previewClip.error}</div>
                )}
              {!showProcessingOverlay && !showStitchOverlay && !previewClip && (
                <div className="quick-builder-preview-empty">
                  Generate a clip or pick one from the shelf below.
                </div>
              )}
              {!showProcessingOverlay &&
                !showStitchOverlay &&
                previewClip?.status === "generating" &&
                !previewJob && (
                  <div className="quick-builder-preview-empty">
                    Click this clip again after refresh, or remove it.
                  </div>
                )}
            </div>
            {stitchedUrl && (
              <div className="quick-builder-stitched">
                <span className="hint">Latest stitch</span>
                <video
                  src={stitchedUrl}
                  controls
                  playsInline
                  className="quick-builder-stitched-video"
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setFilmOpen(true)}
                >
                  Fullscreen
                </button>
              </div>
            )}
          </div>

          <div className="quick-builder-shelf panel">
            <div className="quick-builder-shelf-head">
              <span>
                Clips{" "}
                <span className="hint">
                  ({readyCount} video{stillCount ? ` · ${stillCount} still` : ""})
                </span>
              </span>
              <div className="quick-builder-shelf-actions">
                <span className="hint">
                  {stitchOrder.length
                    ? `${stitchOrder.length} selected for stitch`
                    : "Select clips to stitch"}
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={stitchBusy || stitchOrder.length === 0}
                  onClick={() => void runStitch()}
                >
                  Stitch selected
                </button>
              </div>
            </div>

            {!clips.length ? (
              <p className="hint quick-builder-shelf-empty">
                Your generated clips appear here. Click any to preview — generating clips show live
                progress.
              </p>
            ) : (
              <ul className="quick-builder-clip-list">
                {clips.map((clip) => {
                  const selected = stitchOrder.includes(clip.id);
                  const order = stitchOrder.indexOf(clip.id);
                  const job = clipJobs[clip.id];
                  const jobPct = job ? Math.round(job.progress * 100) : 0;
                  return (
                    <li
                      key={clip.id}
                      className={`quick-builder-clip${selected ? " is-selected" : ""}${previewClipId === clip.id ? " is-focused" : ""}${clip.status === "generating" ? " is-generating" : ""}`}
                    >
                      <button
                        type="button"
                        className="quick-builder-clip-preview"
                        onClick={() => setPreviewClipId(clip.id)}
                      >
                        {clip.videoUrl && clip.status === "ready" ? (
                          <video src={clip.videoUrl} muted playsInline preload="metadata" />
                        ) : clip.keyframeUrl || clip.sourceKeyframeUrl ? (
                          <img src={clip.keyframeUrl ?? clip.sourceKeyframeUrl} alt="" />
                        ) : (
                          <span className="quick-builder-clip-placeholder">
                            {clip.status === "generating" ? (
                              <span className="quick-builder-clip-spinner" aria-hidden />
                            ) : (
                              "!"
                            )}
                          </span>
                        )}
                        {job && (
                          <span className="quick-builder-clip-progress" aria-hidden>
                            <span
                              className="quick-builder-clip-progress-fill"
                              style={{ width: `${jobPct}%` }}
                            />
                          </span>
                        )}
                      </button>
                      <div className="quick-builder-clip-meta">
                        <span className="quick-builder-clip-label">{clip.label}</span>
                        <span className="hint">
                          {clip.status === "still"
                            ? "Still"
                            : clip.mode === "text"
                              ? "Text"
                              : "Image"}
                          {job ? ` · ${jobPct}%` : ""}
                        </span>
                        {clip.status === "error" && (
                          <span className="quick-builder-clip-error">{clip.error}</span>
                        )}
                      </div>
                      <div className="quick-builder-clip-controls">
                        <label className="quick-builder-check">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={clip.status !== "ready"}
                            onChange={() => toggleStitch(clip.id)}
                          />
                          {selected ? `#${order + 1}` : "Stitch"}
                        </label>
                        {selected && stitchOrder.length > 1 && (
                          <span className="quick-builder-clip-order">
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              disabled={order === 0}
                              onClick={() => moveStitch(clip.id, -1)}
                              title="Earlier in stitch"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              disabled={order === stitchOrder.length - 1}
                              onClick={() => moveStitch(clip.id, 1)}
                              title="Later in stitch"
                            >
                              ↓
                            </button>
                          </span>
                        )}
                        {clip.status === "generating" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-stop-qb"
                            title="Stop this clip"
                            onClick={() => cancelClipJob(clip.id)}
                          >
                            ■
                          </button>
                        )}
                        {clip.status === "still" && clip.keyframeId && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            title="Generate video from this still"
                            disabled={!hasApiKey}
                            onClick={() => runVideoForClip(clip)}
                          >
                            ▶
                          </button>
                        )}
                        {clip.videoId && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            title="View API payload sent for this video"
                            onClick={() => openClipPayload(clip)}
                          >
                            {"{}"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          title="Remove from list"
                          onClick={() => removeClip(clip.id)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {filmOpen && stitchedUrl && (
        <FullscreenFilmPlayer
          url={stitchedUrl}
          title="Quick Builder export"
          onClose={() => setFilmOpen(false)}
        />
      )}

      <ApiPayloadModal
        open={payloadModal !== null}
        title={payloadModal?.title ?? "API payload"}
        payload={payloadModal?.payload ?? null}
        onClose={() => setPayloadModal(null)}
      />
    </div>
  );
}