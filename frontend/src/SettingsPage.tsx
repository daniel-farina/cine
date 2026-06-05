import { useCallback, useEffect, useState } from "react";
import { fetchAppSettings, saveAppSettings, saveProject } from "./api";
import { normalizeKeyframeSettings } from "./keyframeSettings";
import {
  DEFAULT_NARRATIVE_MODE,
  NARRATIVE_MODE_OPTIONS,
  type NarrativeModePreference,
} from "./narrativeModes";
import {
  DEFAULT_SCENE_COUNT,
  PLANNING_MODES,
  SCENE_COUNT_OPTIONS,
  type PlanningMode,
} from "./planningModes";
import { normalizeSystemRules, rulesForPrompt } from "./systemRules";
import type { AppSettings, Config, KeyframeSettings, Project } from "./types";

type Scope = "studio" | "project";

type Props = {
  config: Config;
  project: Project | null;
  onBack: () => void;
  onProjectSaved?: (p: Project) => void;
  onStudioSaved?: (s: AppSettings) => void;
};

function projectToSettings(p: Project, config: Config, studio: AppSettings): AppSettings {
  return {
    keyframeSettings: normalizeKeyframeSettings(p.keyframeSettings, config),
    systemRules: normalizeSystemRules(p.systemRules),
    plannerMode: p.plannerMode ?? studio.plannerMode,
    narrativeMode: p.narrativeMode ?? studio.narrativeMode ?? DEFAULT_NARRATIVE_MODE,
    defaultSceneCount: studio.defaultSceneCount,
    bridgeEditPrompt: p.bridgeEditPrompt ?? "",
    motionRules: p.motionRules ?? "",
  };
}

function studioFromApi(s: AppSettings, config: Config): AppSettings {
  return {
    keyframeSettings: normalizeKeyframeSettings(s.keyframeSettings, config),
    systemRules: normalizeSystemRules(s.systemRules),
    plannerMode: s.plannerMode ?? "cinematic",
    narrativeMode: s.narrativeMode ?? DEFAULT_NARRATIVE_MODE,
    defaultSceneCount: s.defaultSceneCount ?? DEFAULT_SCENE_COUNT,
    bridgeEditPrompt: s.bridgeEditPrompt ?? "",
    motionRules: s.motionRules ?? "",
  };
}

export default function SettingsPage({
  config,
  project,
  onBack,
  onProjectSaved,
  onStudioSaved,
}: Props) {
  const [scope, setScope] = useState<Scope>(project ? "project" : "studio");
  const [studio, setStudio] = useState<AppSettings | null>(null);
  const [projectDraft, setProjectDraft] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [rulesExpanded, setRulesExpanded] = useState(true);

  const load = useCallback(async () => {
    const app = studioFromApi(await fetchAppSettings(), config);
    setStudio(app);
    if (project) {
      setProjectDraft(projectToSettings(project, config, app));
    }
  }, [config, project]);

  useEffect(() => {
    void load().catch((e) => setStatus(String(e)));
  }, [load]);

  const draft = scope === "project" && projectDraft ? projectDraft : studio;
  const setDraft = (next: AppSettings) => {
    if (scope === "project") setProjectDraft(next);
    else setStudio(next);
  };

  if (!draft || !studio) {
    return (
      <div className="settings-page">
        <p className="hint">Loading settings…</p>
      </div>
    );
  }

  const patchKs = (partial: Partial<KeyframeSettings>) =>
    setDraft({
      ...draft,
      keyframeSettings: { ...draft.keyframeSettings, ...partial },
    });

  const updateRule = (index: number, value: string) => {
    const next = [...draft.systemRules];
    next[index] = value;
    setDraft({ ...draft, systemRules: next });
  };

  const addRule = () => setDraft({ ...draft, systemRules: [...draft.systemRules, ""] });
  const removeRule = (index: number) =>
    setDraft({ ...draft, systemRules: draft.systemRules.filter((_, i) => i !== index) });

  const handleSave = async () => {
    setBusy(true);
    setStatus("");
    try {
      if (scope === "studio") {
        const { settings } = await saveAppSettings({
          ...draft,
          systemRules: draft.systemRules,
          bridgeEditPrompt: draft.bridgeEditPrompt?.trim() || undefined,
          motionRules: draft.motionRules?.trim() || undefined,
        });
        setStudio(studioFromApi(settings, config));
        onStudioSaved?.(settings);
        setStatus("Studio defaults saved.");
      } else if (project) {
        const saved = await saveProject({
          ...project,
          keyframeSettings: draft.keyframeSettings,
          systemRules: draft.systemRules,
          plannerMode: draft.plannerMode,
          narrativeMode: draft.narrativeMode,
          bridgeEditPrompt: draft.bridgeEditPrompt?.trim() || undefined,
          motionRules: draft.motionRules?.trim() || undefined,
        });
        onProjectSaved?.(saved.project);
        setProjectDraft(projectToSettings(saved.project, config, studio));
        setStatus(`Saved settings for “${saved.project.title}”.`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activeRuleCount = rulesForPrompt(draft.systemRules).length;

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button type="button" className="btn btn-nav-home" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1>Settings</h1>
          <p className="settings-sub">
            Controls image, video, bridge, and scene planning for the whole studio or this film.
          </p>
        </div>
        {!config.hasApiKey && (
          <span className="chip warn">XAI_API_KEY missing — generation disabled</span>
        )}
      </header>

      <div className="settings-scope">
        <button
          type="button"
          className={`settings-scope-btn${scope === "studio" ? " active" : ""}`}
          onClick={() => setScope("studio")}
        >
          Studio defaults
        </button>
        {project && (
          <button
            type="button"
            className={`settings-scope-btn${scope === "project" ? " active" : ""}`}
            onClick={() => setScope("project")}
          >
            This project ({project.title})
          </button>
        )}
      </div>

      <p className="hint settings-scope-hint">
        {scope === "studio"
          ? "New projects inherit these values. Existing projects keep their own settings until you edit them here."
          : "Overrides studio defaults for the open film only."}
      </p>

      <div className="settings-grid">
        <section className="settings-card">
          <h2>Image generation</h2>
          <p className="hint">Keyframes and HD bridge stills</p>
          <label>
            Model
            <select
              value={draft.keyframeSettings.imageModel}
              onChange={(e) => patchKs({ imageModel: e.target.value })}
            >
              {config.imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resolution
            <select
              value={draft.keyframeSettings.imageResolution}
              onChange={(e) => patchKs({ imageResolution: e.target.value })}
            >
              {config.imageResolutions.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aspect ratio
            <select
              value={draft.keyframeSettings.aspectRatio}
              onChange={(e) => patchKs({ aspectRatio: e.target.value })}
            >
              {config.aspectRatios.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-card">
          <h2>Video generation</h2>
          <p className="hint">
            Model: {config.videoModel} (server config)
          </p>
          <label>
            Output resolution
            <select
              value={
                draft.keyframeSettings.videoResolution ??
                config.defaults?.videoResolution ??
                config.videoResolution ??
                "720p"
              }
              onChange={(e) => patchKs({ videoResolution: e.target.value })}
            >
              {(config.videoResolutions?.length
                ? config.videoResolutions
                : ["720p", "480p"]
              ).map((r) => (
                <option key={r} value={r}>
                  {r === "720p" ? "720p (HD, recommended)" : "480p (faster, lower quality)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Clip duration (seconds)
            <input
              type="number"
              min={1}
              max={15}
              value={draft.keyframeSettings.videoDuration ?? config.defaults.videoDuration}
              onChange={(e) => patchKs({ videoDuration: Number(e.target.value) })}
            />
          </label>
        </section>

        <section className="settings-card">
            <h2>Scene planner</h2>
            <p className="hint">Used when you click Plan N scenes</p>
            <label>
              Planning mode
              <select
                value={draft.plannerMode}
                onChange={(e) =>
                  setDraft({ ...draft, plannerMode: e.target.value as PlanningMode })
                }
              >
                {PLANNING_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Narrative mode
              <select
                value={draft.narrativeMode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    narrativeMode: e.target.value as NarrativeModePreference,
                  })
                }
              >
                {NARRATIVE_MODE_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.description}
                  </option>
                ))}
              </select>
            </label>
            {scope === "studio" && (
              <label>
                Default scene count
                <select
                  value={draft.defaultSceneCount}
                  onChange={(e) =>
                    setDraft({ ...draft, defaultSceneCount: Number(e.target.value) })
                  }
                >
                  {SCENE_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} scenes
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

        <section className="settings-card settings-card-wide">
          <button
            type="button"
            className="settings-rules-toggle"
            onClick={() => setRulesExpanded((e) => !e)}
            aria-expanded={rulesExpanded}
          >
            <span>System prompt rules</span>
            <span className="hint">
              {activeRuleCount} active · planner + keyframes + bridge
            </span>
            <span>{rulesExpanded ? "▾" : "▸"}</span>
          </button>
          {rulesExpanded && (
            <>
              <p className="hint">
                Optional. Each rule you add is appended to keyframe prompts, HD bridge edits, and the
                scene planner. Leave empty for no extra constraints — your film brief drives the story.
              </p>
              {draft.systemRules.length === 0 && (
                <p className="hint system-rules-empty">No rules yet — add only what you need.</p>
              )}
              <ul className="system-rules-list">
                {draft.systemRules.map((rule, i) => (
                  <li key={`rule-${i}`} className="system-rules-item">
                    <span className="system-rules-num">{i + 1}</span>
                    <textarea
                      value={rule}
                      rows={3}
                      onChange={(e) => updateRule(i, e.target.value)}
                      placeholder="Add a generation rule…"
                    />
                    <button
                      type="button"
                      className="project-delete"
                      title="Remove rule"
                      onClick={() => removeRule(i)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="system-rules-actions">
                <button type="button" className="btn" onClick={addRule}>
                  + Add rule
                </button>
                {draft.systemRules.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setDraft({ ...draft, systemRules: [] })}
                  >
                    Clear all rules
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="settings-card settings-card-wide">
          <h2>Prompt templates</h2>
          <p className="hint">Optional overrides appended to built-in prompt assembly</p>
          <label>
            HD bridge extra lines
            <textarea
              rows={3}
              value={draft.bridgeEditPrompt ?? ""}
              onChange={(e) => setDraft({ ...draft, bridgeEditPrompt: e.target.value })}
              placeholder="Optional lines after the default upscale/restore instructions…"
            />
          </label>
          <label>
            Video motion suffix
            <textarea
              rows={2}
              value={draft.motionRules ?? ""}
              onChange={(e) => setDraft({ ...draft, motionRules: e.target.value })}
              placeholder="Gradual camera transition only; same location and subjects…"
            />
          </label>
        </section>
      </div>

      <footer className="settings-footer">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleSave()}>
          {busy ? "Saving…" : `Save ${scope === "studio" ? "studio defaults" : "project settings"}`}
        </button>
        {status && <p className={`status${status.includes("Saved") ? " ok" : ""}`}>{status}</p>}
      </footer>
    </div>
  );
}