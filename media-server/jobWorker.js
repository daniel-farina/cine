/**
 * Background job worker — polls Rust API, runs pipelines via tsx (survives UI refresh).
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.CINE_ROOT || path.join(__dirname, "..");
config({ path: path.join(root, ".env") });

const API = process.env.CINE_API_URL || "http://127.0.0.1:8792";

/** jobId -> ChildProcess */
const running = new Map();

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  return { ok: res.ok, data, status: res.status };
}

async function getConfig() {
  const { data } = await api("/api/queue/config");
  return data.maxConcurrentJobs ?? 2;
}

function startJob(job) {
  if (!job?.id || running.has(job.id)) return;
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  const script = path.join(root, "media-server", "runPipeline.ts");
  const child = spawn(tsx, [script, job.id], {
    cwd: root,
    env: { ...process.env, CINE_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.set(job.id, child);
  child.stdout?.on("data", (d) => process.stderr.write(`[job ${job.id}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[job ${job.id}] ${d}`));
  child.on("close", (code) => {
    running.delete(job.id);
    if (code !== 0 && code !== null) {
      console.error(`[job-worker] ${job.id} exited ${code}`);
    }
  });
}

async function tick() {
  const maxSlots = await getConfig();
  while (running.size < maxSlots) {
    const { ok, data } = await api("/api/jobs/worker/next", { method: "POST" });
    if (!ok || !data.job) break;
    startJob(data.job);
  }
}

async function loop() {
  console.error("[job-worker] started", API);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error("[job-worker] tick error", e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

loop();