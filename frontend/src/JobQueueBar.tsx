import { useState } from "react";
import { useJobQueue } from "./JobQueueContext";
import type { Job } from "./jobTypes";

type Props = {
  currentProjectId?: string | null;
  onOpenProject?: (projectId: string) => void;
};

function statusLabel(job: Job): string {
  if (job.status === "queued") return "Queued";
  if (job.status === "running") return "Running";
  if (job.status === "waiting_input") return "Needs input";
  if (job.status === "done") return "Done";
  if (job.status === "error") return "Failed";
  return job.status;
}

export default function JobQueueBar({ currentProjectId, onOpenProject }: Props) {
  const {
    activeJobs,
    running,
    queued,
    settings,
    updateSettings,
    cancel,
    resume,
  } = useJobQueue();
  const [expanded, setExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!activeJobs.length && !expanded) {
    return null;
  }

  const total = activeJobs.length;

  return (
    <div className={`job-queue-bar${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="job-queue-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="job-queue-pulse" aria-hidden />
        <span>
          {running > 0
            ? `${running} running`
            : queued > 0
              ? `${queued} queued`
              : "Jobs"}
          {total > 0 ? ` · ${total} active` : ""}
        </span>
        <span className="job-queue-chevron">{expanded ? "▾" : "▴"}</span>
      </button>

      {expanded && (
        <div className="job-queue-panel">
          <div className="job-queue-toolbar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowSettings((s) => !s)}
            >
              Queue limits
            </button>
            <span className="hint">
              {settings.maxConcurrentJobs} jobs · {settings.maxConcurrentProjects}{" "}
              projects max
            </span>
          </div>

          {showSettings && (
            <div className="job-queue-settings">
              <label>
                Concurrent jobs (1–5)
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={settings.maxConcurrentJobs}
                  onChange={(e) =>
                    void updateSettings({
                      ...settings,
                      maxConcurrentJobs: Number(e.target.value),
                    })
                  }
                />
                <span>{settings.maxConcurrentJobs}</span>
              </label>
              <label>
                Concurrent projects (1–5)
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={settings.maxConcurrentProjects}
                  onChange={(e) =>
                    void updateSettings({
                      ...settings,
                      maxConcurrentProjects: Number(e.target.value),
                    })
                  }
                />
                <span>{settings.maxConcurrentProjects}</span>
              </label>
              <p className="hint">
                Extra jobs wait in queue. Work continues if you switch projects or
                refresh the page.
              </p>
            </div>
          )}

          <ul className="job-queue-list">
            {activeJobs.map((job) => (
              <li
                key={job.id}
                className={`job-queue-item${job.projectId === currentProjectId ? " current" : ""}`}
              >
                <div className="job-queue-item-head">
                  <button
                    type="button"
                    className="job-queue-project-link"
                    onClick={() => onOpenProject?.(job.projectId)}
                  >
                    {job.projectTitle}
                  </button>
                  <span className={`job-queue-status status-${job.status}`}>
                    {statusLabel(job)}
                  </span>
                </div>
                <p className="job-queue-label">{job.label}</p>
                <div className="job-queue-progress-track">
                  <div
                    className="job-queue-progress-fill"
                    style={{ width: `${Math.round(job.progress * 100)}%` }}
                  />
                </div>
                <div className="job-queue-actions">
                  {job.status === "waiting_input" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void resume(job.id)}
                    >
                      Resume after upload
                    </button>
                  )}
                  {job.status !== "done" && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void cancel(job.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!activeJobs.length && (
            <p className="hint job-queue-empty">No active jobs.</p>
          )}
        </div>
      )}
    </div>
  );
}