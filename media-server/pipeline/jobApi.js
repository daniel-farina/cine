/** HTTP helpers for background jobs (Rust API + media server). */

const API_BASE = process.env.CINE_API_URL || "http://127.0.0.1:8792";
const MEDIA_BASE = process.env.CINE_MEDIA_URL || "http://127.0.0.1:8793";

async function apiJson(url, init = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) throw new Error(data.error || data.message || `${res.status} ${url}`);
  return data;
}

async function mediaJson(url, init = {}) {
  const res = await fetch(`${MEDIA_BASE}${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) throw new Error(data.error || `${res.status} ${url}`);
  return data;
}

export async function fetchProject(projectId) {
  return apiJson(`/api/projects/${projectId}`);
}

export async function saveProject(project) {
  const data = await apiJson(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify(project),
  });
  return data.project;
}

export async function fetchAssets() {
  return apiJson("/api/assets");
}

export async function fetchAppSettings() {
  return apiJson("/api/settings");
}

export async function fetchConfig() {
  return apiJson("/api/config");
}

export async function patchJobProgress(jobId, patch) {
  return apiJson(`/api/jobs/${jobId}/progress`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export async function setJobWaiting(jobId, label, progressDetail) {
  return apiJson(`/api/jobs/${jobId}/waiting`, {
    method: "POST",
    body: JSON.stringify({ label, progressDetail }),
  });
}

export async function finishJob(jobId, status, error, progressDetail) {
  return apiJson(`/api/jobs/${jobId}/finish`, {
    method: "POST",
    body: JSON.stringify({
      status,
      error: error || undefined,
      progress: status === "done" ? 1 : undefined,
      progressDetail,
    }),
  });
}

export async function isJobCancelled(jobId) {
  const data = await apiJson(`/api/jobs/${jobId}`);
  return data.status === "cancelled";
}

export async function claimNextJob() {
  return apiJson("/api/jobs/worker/next", { method: "POST" });
}

export async function getQueueConfig() {
  return apiJson("/api/queue/config");
}

export {
  apiJson,
  mediaJson,
  API_BASE,
  MEDIA_BASE,
};