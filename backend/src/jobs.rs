use crate::db::Db;
use anyhow::{Context, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

pub const JOB_STATUS_QUEUED: &str = "queued";
pub const JOB_STATUS_RUNNING: &str = "running";
pub const JOB_STATUS_WAITING: &str = "waiting_input";
pub const JOB_STATUS_DONE: &str = "done";
pub const JOB_STATUS_ERROR: &str = "error";
pub const JOB_STATUS_CANCELLED: &str = "cancelled";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueSettings {
    #[serde(rename = "maxConcurrentJobs", default = "default_max_jobs")]
    pub max_concurrent_jobs: u32,
    #[serde(rename = "maxConcurrentProjects", default = "default_max_projects")]
    pub max_concurrent_projects: u32,
}

fn default_max_jobs() -> u32 {
    2
}
fn default_max_projects() -> u32 {
    5
}

impl Default for QueueSettings {
    fn default() -> Self {
        Self {
            max_concurrent_jobs: 2,
            max_concurrent_projects: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectTitle")]
    pub project_title: String,
    pub kind: String,
    pub status: String,
    pub progress: f64,
    pub label: String,
    pub payload: Value,
    #[serde(rename = "progressDetail", skip_serializing_if = "Option::is_none")]
    pub progress_detail: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(rename = "finishedAt", skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EnqueueJobBody {
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub kind: String,
    #[serde(default)]
    pub payload: Value,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct JobProgressBody {
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(rename = "progressDetail", default)]
    pub progress_detail: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct JobFinishBody {
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(rename = "progressDetail", default)]
    pub progress_detail: Option<Value>,
}

impl Db {
    /// Jobs left `running` after a crash/restart — put back in queue.
    pub fn requeue_stale_running_jobs(&self) -> Result<u32> {
        let now = chrono::Utc::now().to_rfc3339();
        let n = self.conn()?.execute(
            "UPDATE jobs SET status = 'queued', started_at = NULL, label = 'Resuming after restart…', updated_at = ?1 WHERE status = 'running'",
            [&now],
        )?;
        Ok(n as u32)
    }

    pub fn ensure_jobs_schema(&self) -> Result<()> {
        self.conn()?.execute_batch(
            r"
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              project_title TEXT NOT NULL DEFAULT '',
              kind TEXT NOT NULL,
              status TEXT NOT NULL,
              progress REAL NOT NULL DEFAULT 0,
              label TEXT NOT NULL DEFAULT '',
              payload TEXT NOT NULL DEFAULT '{}',
              progress_detail TEXT,
              error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              started_at TEXT,
              finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
            CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
            ",
        )?;
        Ok(())
    }

    pub fn queue_settings(&self) -> Result<QueueSettings> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT value FROM app_meta WHERE key = 'queue_settings'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let raw: String = row.get(0)?;
            let mut s: QueueSettings =
                serde_json::from_str(&raw).unwrap_or_else(|_| QueueSettings::default());
            s.max_concurrent_jobs = s.max_concurrent_jobs.clamp(1, 5);
            s.max_concurrent_projects = s.max_concurrent_projects.clamp(1, 5);
            return Ok(s);
        }
        Ok(QueueSettings::default())
    }

    pub fn save_queue_settings(&self, settings: QueueSettings) -> Result<QueueSettings> {
        let mut s = settings;
        s.max_concurrent_jobs = s.max_concurrent_jobs.clamp(1, 5);
        s.max_concurrent_projects = s.max_concurrent_projects.clamp(1, 5);
        let raw = serde_json::to_string(&s)?;
        self.conn()?.execute(
            "INSERT INTO app_meta (key, value) VALUES ('queue_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [raw],
        )?;
        Ok(s)
    }

    fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<Job> {
        let progress_detail: Option<String> = row.get(8)?;
        Ok(Job {
            id: row.get(0)?,
            project_id: row.get(1)?,
            project_title: row.get(2)?,
            kind: row.get(3)?,
            status: row.get(4)?,
            progress: row.get(5)?,
            label: row.get(6)?,
            payload: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or(json!({})),
            progress_detail: progress_detail
                .map(|s| serde_json::from_str(&s).ok())
                .flatten(),
            error: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
            started_at: row.get(12)?,
            finished_at: row.get(13)?,
        })
    }

    pub fn list_jobs(&self, include_done: bool) -> Result<Vec<Job>> {
        let conn = self.conn()?;
        let sql = if include_done {
            "SELECT id, project_id, project_title, kind, status, progress, label, payload, progress_detail, error, created_at, updated_at, started_at, finished_at FROM jobs ORDER BY created_at DESC LIMIT 200"
        } else {
            "SELECT id, project_id, project_title, kind, status, progress, label, payload, progress_detail, error, created_at, updated_at, started_at, finished_at FROM jobs WHERE status IN ('queued','running','waiting_input') ORDER BY created_at ASC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], Self::row_to_job)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    pub fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, project_id, project_title, kind, status, progress, label, payload, progress_detail, error, created_at, updated_at, started_at, finished_at FROM jobs WHERE id = ?",
        )?;
        let job = stmt
            .query_row([id], Self::row_to_job)
            .optional()?;
        Ok(job)
    }

    pub fn enqueue_job(
        &self,
        project_id: &str,
        project_title: &str,
        kind: &str,
        label: &str,
        payload: Value,
    ) -> Result<Job> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        let payload_s = serde_json::to_string(&payload)?;
        self.conn()?.execute(
            r"INSERT INTO jobs (id, project_id, project_title, kind, status, progress, label, payload, created_at, updated_at)
              VALUES (?1,?2,?3,?4,'queued',0,?5,?6,?7,?7)",
            params![id, project_id, project_title, kind, label, payload_s, now],
        )?;
        self.get_job(&id)?.context("job insert failed")
    }

    pub fn count_running_jobs(&self) -> Result<u32> {
        let conn = self.conn()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM jobs WHERE status = 'running'",
            [],
            |r| r.get(0),
        )?;
        Ok(n as u32)
    }

    pub fn count_running_projects(&self) -> Result<u32> {
        let conn = self.conn()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT project_id) FROM jobs WHERE status = 'running'",
            [],
            |r| r.get(0),
        )?;
        Ok(n as u32)
    }

    pub fn project_has_running_job(&self, project_id: &str) -> Result<bool> {
        let conn = self.conn()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM jobs WHERE status = 'running' AND project_id = ?",
            [project_id],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    /// Claim next queued job if capacity allows.
    pub fn claim_next_job(&self) -> Result<Option<Job>> {
        let settings = self.queue_settings()?;
        if self.count_running_jobs()? >= settings.max_concurrent_jobs {
            return Ok(None);
        }
        if self.count_running_projects()? >= settings.max_concurrent_projects {
            return Ok(None);
        }

        let conn = self.conn()?;
        let candidate: Option<String> = conn
            .query_row(
                r"SELECT j.id FROM jobs j
                  WHERE j.status = 'queued'
                  AND NOT EXISTS (
                    SELECT 1 FROM jobs r WHERE r.status = 'running' AND r.project_id = j.project_id
                  )
                  ORDER BY j.created_at ASC
                  LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;

        let Some(id) = candidate else {
            return Ok(None);
        };

        let now = chrono::Utc::now().to_rfc3339();
        let updated = conn.execute(
            "UPDATE jobs SET status = 'running', started_at = ?1, updated_at = ?1, label = 'Starting…' WHERE id = ?2 AND status = 'queued'",
            params![now, id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.get_job(&id)
    }

    pub fn update_job_progress(
        &self,
        id: &str,
        progress: Option<f64>,
        label: Option<&str>,
        progress_detail: Option<Value>,
    ) -> Result<Option<Job>> {
        let now = chrono::Utc::now().to_rfc3339();
        let detail_s = progress_detail
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let conn = self.conn()?;
        if let Some(p) = progress {
            if let Some(l) = label {
                if let Some(ref d) = detail_s {
                    conn.execute(
                        "UPDATE jobs SET progress = ?1, label = ?2, progress_detail = ?3, updated_at = ?4 WHERE id = ?5",
                        params![p, l, d, now, id],
                    )?;
                } else {
                    conn.execute(
                        "UPDATE jobs SET progress = ?1, label = ?2, updated_at = ?3 WHERE id = ?4",
                        params![p, l, now, id],
                    )?;
                }
            } else if let Some(ref d) = detail_s {
                conn.execute(
                    "UPDATE jobs SET progress = ?1, progress_detail = ?2, updated_at = ?3 WHERE id = ?4",
                    params![p, d, now, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE jobs SET progress = ?1, updated_at = ?2 WHERE id = ?3",
                    params![p, now, id],
                )?;
            }
        } else if let Some(l) = label {
            if let Some(ref d) = detail_s {
                conn.execute(
                    "UPDATE jobs SET label = ?1, progress_detail = ?2, updated_at = ?3 WHERE id = ?4",
                    params![l, d, now, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE jobs SET label = ?1, updated_at = ?2 WHERE id = ?3",
                    params![l, now, id],
                )?;
            }
        }
        self.get_job(id)
    }

    pub fn set_job_waiting(&self, id: &str, label: &str) -> Result<Option<Job>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn()?.execute(
            "UPDATE jobs SET status = 'waiting_input', label = ?1, updated_at = ?2 WHERE id = ?3 AND status IN ('running','queued')",
            params![label, now, id],
        )?;
        self.get_job(id)
    }

    pub fn finish_job(
        &self,
        id: &str,
        status: &str,
        error: Option<&str>,
        progress: Option<f64>,
        progress_detail: Option<Value>,
    ) -> Result<Option<Job>> {
        let now = chrono::Utc::now().to_rfc3339();
        let detail_s = progress_detail
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let conn = self.conn()?;
        let prog = progress.unwrap_or(if status == JOB_STATUS_DONE { 1.0 } else { 0.0 });
        conn.execute(
            "UPDATE jobs SET status = ?1, error = ?2, progress = ?3, progress_detail = COALESCE(?4, progress_detail), finished_at = ?5, updated_at = ?5 WHERE id = ?6",
            params![status, error, prog, detail_s, now, id],
        )?;
        self.get_job(id)
    }

    pub fn cancel_job(&self, id: &str) -> Result<Option<Job>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn()?.execute(
            "UPDATE jobs SET status = 'cancelled', label = 'Cancelled', finished_at = ?1, updated_at = ?1 WHERE id = ?2 AND status IN ('queued','running','waiting_input')",
            params![now, id],
        )?;
        self.get_job(id)
    }

    pub fn resume_job(&self, id: &str) -> Result<Option<Job>> {
        let now = chrono::Utc::now().to_rfc3339();
        let updated = self.conn()?.execute(
            "UPDATE jobs SET status = 'queued', label = 'Resuming…', updated_at = ?1, started_at = NULL WHERE id = ?2 AND status = 'waiting_input'",
            params![now, id],
        )?;
        if updated == 0 {
            return Ok(None);
        }
        self.get_job(id)
    }

    pub fn is_job_cancelled(&self, id: &str) -> Result<bool> {
        let conn = self.conn()?;
        let status: Option<String> = conn
            .query_row("SELECT status FROM jobs WHERE id = ?", [id], |r| r.get(0))
            .optional()?;
        Ok(status.as_deref() == Some(JOB_STATUS_CANCELLED))
    }
}

pub fn queue_summary(db: &Arc<Db>) -> Result<Value> {
    let jobs = db.list_jobs(false)?;
    let settings = db.queue_settings()?;
    Ok(json!({
        "settings": settings,
        "running": db.count_running_jobs()?,
        "runningProjects": db.count_running_projects()?,
        "queued": jobs.iter().filter(|j| j.status == JOB_STATUS_QUEUED).count(),
        "jobs": jobs,
    }))
}