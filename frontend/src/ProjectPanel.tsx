import { useState } from "react";
import {
  activateProject,
  createProject,
  deleteProject,
  fetchProject,
} from "./api";
import type { Project, ProjectMeta } from "./types";

type Props = {
  activeId: string | null;
  projects: ProjectMeta[];
  onIndexChange: () => void;
  onProjectLoaded: (p: Project) => void;
};

export default function ProjectPanel({
  activeId,
  projects,
  onIndexChange,
  onProjectLoaded,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [template, setTemplate] = useState<"blank" | "lighthouse">("blank");
  const [busy, setBusy] = useState(false);

  const switchProject = async (id: string) => {
    setBusy(true);
    try {
      await activateProject(id);
      onProjectLoaded(await fetchProject(id));
      onIndexChange();
      setOpen(false);
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
      onProjectLoaded(p);
      onIndexChange();
      setNewTitle("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete project “${title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { activeId: nextId } = await deleteProject(id);
      onIndexChange();
      if (nextId) {
        onProjectLoaded(await fetchProject(nextId));
      }
    } finally {
      setBusy(false);
    }
  };

  const activeTitle = projects.find((p) => p.id === activeId)?.title ?? "Projects";

  return (
    <div className="project-panel">
      <button
        type="button"
        className="project-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="project-trigger-label">Project</span>
        <span className="project-trigger-title">{activeTitle}</span>
        <span className="project-trigger-chevron">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="project-dropdown">
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className={p.id === activeId ? "active" : ""}>
                <button
                  type="button"
                  className="project-item"
                  disabled={busy}
                  onClick={() => switchProject(p.id)}
                >
                  <span className="project-item-title">{p.title}</span>
                  <span className="project-item-meta">
                    {p.sceneCount} scene{p.sceneCount === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  type="button"
                  className="project-delete"
                  disabled={busy || projects.length <= 1}
                  title="Delete project"
                  onClick={() => handleDelete(p.id, p.title)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="project-new">
            <input
              type="text"
              placeholder="New project title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as "blank" | "lighthouse")}
            >
              <option value="blank">Empty (1 scene)</option>
              <option value="lighthouse">Lighthouse template (3 scenes)</option>
            </select>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleCreate}>
              + New project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}