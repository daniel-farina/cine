import { useState } from "react";
import { activateProject, createProject, deleteProject, fetchProject } from "./api";
import { resolvePosterPreview } from "./sceneAssets";
import type { Asset, Project, ProjectMeta } from "./types";

type Props = {
  projects: ProjectMeta[];
  assets: Asset[];
  hasApiKey: boolean;
  onIndexChange: () => void;
  onOpenProject: (project: Project) => void;
  onOpenSettings: () => void;
  onOpenQuickBuilder: () => void;
};

function formatUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function HomePage({
  projects,
  assets,
  hasApiKey,
  onIndexChange,
  onOpenProject,
  onOpenSettings,
  onOpenQuickBuilder,
}: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [template, setTemplate] = useState<"blank" | "lighthouse">("blank");
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const openProject = async (id: string) => {
    setBusy(true);
    try {
      await activateProject(id);
      onOpenProject(await fetchProject(id));
      onIndexChange();
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const p = await createProject({
        title: newTitle.trim() || "Untitled film",
        template,
      });
      onOpenProject(p);
      onIndexChange();
      setNewTitle("");
      setShowNew(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    if (!confirm(`Delete “${title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteProject(id);
      onIndexChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home-page">
      <header className="home-header">
        <div>
          <h1>Projects</h1>
          <p className="home-tagline">Your films — pick a project or start a new one.</p>
        </div>
        <div className="home-header-actions">
          <button type="button" className="btn btn-primary" onClick={onOpenQuickBuilder}>
            Quick Builder
          </button>
          <button type="button" className="btn" onClick={onOpenSettings}>
            Settings
          </button>
          {!hasApiKey && (
            <span className="chip warn">Add XAI_API_KEY to generate media</span>
          )}
        </div>
      </header>

      <div className="home-grid">
        <button
          type="button"
          className="home-card home-card-quick"
          disabled={busy}
          onClick={onOpenQuickBuilder}
        >
          <span className="home-card-quick-icon" aria-hidden>
            ⚡
          </span>
          <span className="home-card-quick-label">Quick Builder</span>
          <span className="home-card-quick-sub hint">
            Text or image → video · stitch clips
          </span>
        </button>

        <button
          type="button"
          className="home-card home-card-new"
          disabled={busy}
          onClick={() => setShowNew((s) => !s)}
        >
          <span className="home-card-new-icon">+</span>
          <span className="home-card-new-label">New Project</span>
        </button>

        {projects.map((p) => {
          const poster = resolvePosterPreview(p.posterAssetId, assets);
          return (
            <article key={p.id} className="home-card home-card-project">
              <button
                type="button"
                className="home-card-open"
                disabled={busy}
                onClick={() => openProject(p.id)}
              >
                <div className="home-card-poster">
                  {poster ? (
                    poster.kind === "video" ? (
                      <video
                        src={poster.url}
                        muted
                        playsInline
                        preload="metadata"
                        aria-hidden
                      />
                    ) : (
                      <img src={poster.url} alt="" />
                    )
                  ) : (
                    <span className="home-card-poster-empty">No media yet</span>
                  )}
                </div>
                <div className="home-card-meta">
                  <span className="home-card-title">{p.title}</span>
                  <span className="home-card-sub">
                    {p.sceneCount} scene{p.sceneCount === 1 ? "" : "s"} · {formatUpdated(p.updatedAt)}
                  </span>
                </div>
              </button>
              <button
                type="button"
                className="home-card-delete"
                title="Delete project"
                disabled={busy || projects.length <= 1}
                onClick={(e) => handleDelete(e, p.id, p.title)}
              >
                ×
              </button>
            </article>
          );
        })}
      </div>

      {showNew && (
        <div className="home-new-panel">
          <h2>New project</h2>
          <input
            type="text"
            placeholder="Film title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as "blank" | "lighthouse")}
          >
            <option value="blank">Empty (1 scene)</option>
            <option value="lighthouse">Lighthouse template (3 scenes)</option>
          </select>
          <div className="home-new-actions">
            <button type="button" className="btn" onClick={() => setShowNew(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleCreate}>
              Create & open
            </button>
          </div>
        </div>
      )}
    </div>
  );
}