import cors from "cors";
import { execFile, spawn } from "child_process";
import crypto from "crypto";
import dns from "dns";
import { lookup } from "dns/promises";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { createCurlFetch } from "../scripts/xai-curl-fetch.mjs";
import * as db from "./db.js";
import { alignScenePair } from "./planner/sceneAlign.js";
import { planScenes, planScenesStream } from "./planner/scenePlan.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CINE_ROOT || path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

// PM2 often cannot resolve api.x.ai; curl --resolve fixes xAI API calls.
globalThis.fetch = createCurlFetch();

const API_KEY = process.env.XAI_API_KEY;
const API_BASE = "https://api.x.ai/v1";
const OUTPUT = path.join(ROOT, "output");
const META_FILE = path.join(OUTPUT, "manifest.json");
const PROJECT_FILE = path.join(OUTPUT, "project.json"); // legacy import only
const PROJECTS_DIR = path.join(OUTPUT, "projects");
const INDEX_FILE = path.join(OUTPUT, "projects-index.json");
const DB_PATH = path.join(OUTPUT, "cine.db");
const PORT = Number(process.env.CINE_MEDIA_PORT) || 8793;
const PUBLIC_BASE = process.env.CINE_PUBLIC_URL || `http://127.0.0.1:${PORT}`;

const IMAGE_MODELS = [
  { id: "grok-imagine-image-quality", label: "Quality (best)" },
  { id: "grok-imagine-image", label: "Fast" },
];
const VIDEO_MODEL = "grok-imagine-video-1.5-preview";
const IMAGE_RESOLUTIONS = ["2k", "1k"];
const VIDEO_RESOLUTIONS = ["720p", "480p"];
const DEFAULT_VIDEO_RESOLUTION = "720p";

function normalizeVideoResolution(resolution) {
  const v = String(resolution || "")
    .trim()
    .toLowerCase();
  return v === "720p" || v === "480p" ? v : DEFAULT_VIDEO_RESOLUTION;
}
const ASPECT_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "20:9",
  "9:20",
];

const app = express();
app.use(cors());
/** Base64 JSON uploads up to MAX_UPLOAD_BYTES (~33MB encoded for 25MB raw). */
app.use(express.json({ limit: "36mb" }));

async function ensureOutput() {
  await fs.mkdir(OUTPUT, { recursive: true });
  try {
    await fs.access(META_FILE);
  } catch {
    await fs.writeFile(META_FILE, "[]");
  }
}

function blankProject(title = "Untitled film") {
  const now = new Date().toISOString();
  const sceneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    title,
    logline: "",
    scenes: [
      {
        id: sceneId,
        title: "Scene 1",
        imagePrompt: "",
        motionPrompt:
          "Slow subtle dolly in, eye level, 35mm, gradual transition, same framing as keyframe",
        status: "empty",
      },
    ],
    selectedSceneId: sceneId,
    createdAt: now,
    updatedAt: now,
  };
}

async function readManifest() {
  await ensureOutput();
  return JSON.parse(await fs.readFile(META_FILE, "utf8"));
}

async function writeManifest(items) {
  await fs.writeFile(META_FILE, JSON.stringify(items, null, 2));
}

async function addAsset(entry) {
  const items = await readManifest();
  items.unshift(entry);
  await writeManifest(items);
  return entry;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function sniffImageExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (
    buf.length >= 6 &&
    (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "gif";
  }
  return null;
}

async function saveUploadedImage({ dataBase64, mimeType, sceneId, label, originalName }) {
  if (!dataBase64 || typeof dataBase64 !== "string") {
    throw new Error("dataBase64 required");
  }
  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length) throw new Error("Empty file");
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`);
  }
  let ext = sniffImageExt(buf);
  if (!ext) {
    if (mimeType === "image/png") ext = "png";
    else if (mimeType === "image/webp") ext = "webp";
    else if (mimeType === "image/gif") ext = "gif";
    else if (mimeType === "image/jpeg" || mimeType === "image/jpg") ext = "jpg";
    else throw new Error("Unsupported image type (use PNG, JPEG, WebP, or GIF)");
  }

  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  await fs.writeFile(path.join(OUTPUT, filename), buf);

  const displayName = originalName?.trim() || "Uploaded keyframe";
  return addAsset({
    id,
    type: "image",
    filename,
    url: `/files/${filename}`,
    prompt: `User upload: ${displayName}`,
    sceneId: sceneId || undefined,
    label: label?.trim() || displayName,
    source: "upload",
    createdAt: new Date().toISOString(),
  });
}

async function getAsset(id) {
  const items = await readManifest();
  return items.find((a) => a.id === id);
}

function apiHeaders() {
  if (!API_KEY) throw new Error("XAI_API_KEY missing in .env");
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
}

function apiErrorMessage(data, fallback) {
  return (
    (typeof data?.error === "string" && data.error) ||
    data?.error?.message ||
    data?.message ||
    fallback
  );
}

async function apiPost(pathname, body) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.statusText));
  return data;
}

async function apiGet(pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, { headers: apiHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiErrorMessage(data, res.statusText));
  return data;
}

async function resolveHostIpv4(hostname) {
  try {
    const { stdout } = await execFileAsync(
      "dig",
      ["@1.1.1.1", "+short", hostname, "A"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 }
    );
    const ip = stdout
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(l));
    if (ip) return ip;
  } catch {
    /* fall through */
  }
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  return (await lookup(hostname, { family: 4 })).address;
}

async function downloadToFile(url, dest) {
  const u = new URL(url);
  let ip;
  try {
    ip = await resolveHostIpv4(u.hostname);
  } catch (e) {
    throw new Error(`Download DNS failed for ${u.hostname}: ${e.message}`);
  }
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const args = [
    "-sS",
    "-L",
    "--resolve",
    `${u.hostname}:${port}:${ip}`,
    "-o",
    dest,
    url,
  ];
  try {
    await execFileAsync("/usr/bin/curl", args, { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`Download failed: ${e.message || e}`);
  }
}

function publicFileUrl(filename) {
  return `${PUBLIC_BASE}/files/${filename}`;
}

async function resolvePublicUrl(asset) {
  if (!asset) return null;
  if (asset.remoteUrl && !asset.remoteUrl.includes("127.0.0.1")) return asset.remoteUrl;
  return publicFileUrl(asset.filename);
}

async function generateImageAsset({
  prompt,
  model = IMAGE_MODELS[0].id,
  aspect_ratio = "16:9",
  resolution = "2k",
  sceneId,
  label,
}) {
  const data = await apiPost("/images/generations", {
    model,
    prompt,
    aspect_ratio,
    resolution,
    response_format: "url",
  });
  const remoteUrl = data.data?.[0]?.url;
  if (!remoteUrl) throw new Error("No image URL");

  const id = crypto.randomUUID();
  const filename = `${id}.png`;
  await downloadToFile(remoteUrl, path.join(OUTPUT, filename));

  return addAsset({
    id,
    type: "image",
    filename,
    url: `/files/${filename}`,
    remoteUrl,
    prompt,
    model,
    resolution,
    aspect_ratio,
    sceneId,
    label,
    source: "generate",
    createdAt: new Date().toISOString(),
  });
}

async function imageInputFromAsset(asset) {
  const remote = await resolvePublicUrl(asset);
  if (remote && !remote.includes("127.0.0.1")) {
    return { url: remote, type: "image_url" };
  }
  const buf = await fs.readFile(path.join(OUTPUT, asset.filename));
  const b64 = buf.toString("base64");
  const mime = asset.filename.endsWith(".png") ? "image/png" : "image/jpeg";
  return { url: `data:${mime};base64,${b64}`, type: "image_url" };
}

async function editImageAsset({
  prompt,
  sourceAssetId,
  model = IMAGE_MODELS[0].id,
  aspect_ratio = "16:9",
  resolution = "2k",
  sceneId,
  label,
}) {
  const source = await getAsset(sourceAssetId);
  if (!source) throw new Error("Source image not found");

  const data = await apiPost("/images/edits", {
    model,
    prompt,
    image: await imageInputFromAsset(source),
    aspect_ratio,
    resolution,
    response_format: "url",
  });

  const remoteUrl = data.data?.[0]?.url;
  if (!remoteUrl) throw new Error("No edited image URL");

  const id = crypto.randomUUID();
  const filename = `${id}.png`;
  await downloadToFile(remoteUrl, path.join(OUTPUT, filename));

  return addAsset({
    id,
    type: "image",
    filename,
    url: `/files/${filename}`,
    remoteUrl,
    prompt,
    model,
    resolution,
    aspect_ratio,
    sceneId,
    label,
    source: "edit",
    sourceAssetId,
    createdAt: new Date().toISOString(),
  });
}

async function pollVideoDone(requestId) {
  for (let i = 0; i < 120; i++) {
    const data = await apiGet(`/videos/${requestId}`);
    if (data.status === "done") return data;
    if (data.status === "failed" || data.status === "expired") {
      throw new Error(data.error?.message || `Video ${data.status}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Video timed out");
}

async function generateVideoAsset({ prompt, sourceImageId, duration = 10, aspect_ratio = "16:9", resolution = "720p", sceneId }) {
  if (!sourceImageId) {
    throw new Error(
      "grok-imagine-video-1.5-preview requires a keyframe (image-to-video). Generate or upload a still first."
    );
  }
  const img = await getAsset(sourceImageId);
  if (!img) throw new Error("Keyframe image not found");

  const body = {
    model: VIDEO_MODEL,
    prompt,
    duration,
    aspect_ratio,
    resolution: normalizeVideoResolution(resolution),
    image: await imageInputFromAsset(img),
  };

  const start = await apiPost("/videos/generations", body);

  const data = await pollVideoDone(start.request_id);
  const remoteUrl = data.video?.url;
  if (!remoteUrl) throw new Error("No video URL");

  const id = crypto.randomUUID();
  const filename = `${id}.mp4`;
  await downloadToFile(remoteUrl, path.join(OUTPUT, filename));

  return addAsset({
    id,
    type: "video",
    filename,
    url: `/files/${filename}`,
    remoteUrl,
    prompt,
    model: VIDEO_MODEL,
    duration,
    aspect_ratio,
    resolution,
    sourceImageId,
    sceneId,
    createdAt: new Date().toISOString(),
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500)))));
  });
}

app.post("/api/plan/scenes", async (req, res) => {
  try {
    if (!API_KEY) return res.status(400).json({ error: "XAI_API_KEY missing in .env" });
    const {
      brief,
      mode = "cinematic",
      shotCount = 12,
      aspectRatio,
      systemRules,
      continuation,
    } = req.body;
    const { redactPlanRequest } = await import("../planner/planLog.js");
    console.error("[cine-plan] request", redactPlanRequest(req.body));
    if (!brief?.trim()) return res.status(400).json({ error: "Brief description is required" });
    const plan = await planScenes({
      apiBase: API_BASE,
      apiKey: API_KEY,
      mode,
      brief,
      shotCount: Math.min(24, Math.max(1, Number(shotCount) || 12)),
      aspectRatio,
      systemRules: Array.isArray(systemRules) ? systemRules : undefined,
      continuation,
    });
    console.error("[cine-plan] ok", { shotCount: plan.shots?.length });
    res.json(plan);
  } catch (e) {
    console.error("[cine-plan] error", e.message || e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/plan/scenes/stream", async (req, res) => {
  try {
    if (!API_KEY) return res.status(400).json({ error: "XAI_API_KEY missing in .env" });
    const {
      brief,
      mode = "cinematic",
      shotCount = 12,
      aspectRatio,
      systemRules,
      continuation,
    } = req.body;
    const { redactPlanRequest } = await import("../planner/planLog.js");
    console.error("[cine-plan] stream request", redactPlanRequest(req.body));
    if (!brief?.trim()) return res.status(400).json({ error: "Brief description is required" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    await planScenesStream({
      apiBase: API_BASE,
      apiKey: API_KEY,
      mode,
      brief,
      shotCount: Math.min(24, Math.max(1, Number(shotCount) || 12)),
      aspectRatio,
      systemRules: Array.isArray(systemRules) ? systemRules : undefined,
      continuation,
      res,
    });
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(e.message) });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(e.message) })}\n\n`);
      res.end();
    }
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "cine-studio",
    version: 2,
    features: ["projects", "sqlite", "scenes", "stitch", "plan_scenes"],
    port: PORT,
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    imageModels: IMAGE_MODELS,
    videoModel: VIDEO_MODEL,
    imageResolutions: IMAGE_RESOLUTIONS,
    videoResolution: DEFAULT_VIDEO_RESOLUTION,
    videoResolutions: VIDEO_RESOLUTIONS,
    aspectRatios: ASPECT_RATIOS,
    defaults: {
      imageModel: IMAGE_MODELS[0].id,
      imageResolution: "2k",
      aspectRatio: "16:9",
      videoDuration: 10,
      videoResolution: DEFAULT_VIDEO_RESOLUTION,
    },
    hasApiKey: Boolean(API_KEY),
    publicBase: PUBLIC_BASE,
  });
});

app.get("/api/assets", async (_req, res) => {
  try {
    res.json(await readManifest());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/projects", (_req, res) => {
  try {
    res.json(db.getProjectsIndex());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/projects/active", (_req, res) => {
  try {
    let activeId = db.getActiveProjectId();
    if (!activeId) {
      const project = db.saveProject(blankProject("My first film"));
      db.setActiveProjectId(project.id);
      return res.json(project);
    }
    let project = db.getProjectById(activeId);
    if (!project) {
      project = db.saveProject(blankProject("My first film"));
      db.setActiveProjectId(project.id);
    }
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get("/api/projects/:id", (req, res) => {
  try {
    const project = db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { title, logline, template, scenes } = req.body;
    let project;
    if (scenes?.length) {
      const now = new Date().toISOString();
      project = {
        id: crypto.randomUUID(),
        title: title?.trim() || "Untitled film",
        logline: logline || "",
        scenes,
        selectedSceneId: scenes[0]?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
    } else if (template === "lighthouse") {
      project = blankProject(title?.trim() || "The Lighthouse Signal");
      project.logline =
        "A keeper discovers an impossible light on the horizon — each scene continues from the last frame.";
      project.scenes = [
        {
          id: crypto.randomUUID(),
          title: "Dawn at the cliff",
          imagePrompt:
            "Cinematic wide shot, lonely lighthouse on Atlantic cliff at dawn, golden mist, keeper silhouette with lantern, photorealistic 2K film still",
          motionPrompt: "Slow crane down toward lighthouse, waves roll, mist drifts",
          status: "empty",
        },
        {
          id: crypto.randomUUID(),
          title: "Strange horizon glow",
          imagePrompt:
            "Same lighthouse, impossible teal aurora on horizon, keeper on gallery railing, cinematic suspense",
          motionPrompt: "Slow push-in on keeper, aurora pulses, lens flare",
          status: "empty",
        },
        {
          id: crypto.randomUUID(),
          title: "Signal answered",
          imagePrompt:
            "Lighthouse lamp room at night, fresnel lens beam, keeper's hands on brass, dramatic chiaroscuro",
          motionPrompt: "Lens rotates, beam sweeps, dust motes swirl",
          status: "empty",
        },
      ];
      project.selectedSceneId = project.scenes[0].id;
    } else {
      project = blankProject(title?.trim() || "Untitled film");
      if (logline) project.logline = logline;
    }

    const saved = db.saveProject(project);
    db.setActiveProjectId(saved.id);
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.put("/api/projects/:id", (req, res) => {
  try {
    const project = { ...req.body, id: req.params.id };
    if (!project.scenes) return res.status(400).json({ error: "Invalid project" });
    const saved = db.saveProject(project);
    res.json({ ok: true, project: saved });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/projects/:id/activate", (req, res) => {
  try {
    if (!db.getProjectById(req.params.id)) {
      return res.status(404).json({ error: "Project not found" });
    }
    db.setActiveProjectId(req.params.id);
    res.json({ activeId: req.params.id });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.delete("/api/projects/:id", (req, res) => {
  try {
    let activeId = db.deleteProject(req.params.id);
    if (!activeId) {
      const fresh = db.saveProject(blankProject("My first film"));
      db.setActiveProjectId(fresh.id);
      activeId = fresh.id;
    }
    res.json({ activeId });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

/** @deprecated use /api/projects/active */
app.get("/api/project", (_req, res) => {
  try {
    const activeId = db.getActiveProjectId();
    if (!activeId) return res.json(blankProject());
    const project = db.getProjectById(activeId);
    res.json(project ?? blankProject());
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

/** @deprecated use PUT /api/projects/:id */
app.put("/api/project", (req, res) => {
  try {
    const id = req.body.id || db.getActiveProjectId() || crypto.randomUUID();
    db.saveProject({ ...req.body, id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/assets/upload", async (req, res) => {
  try {
    const { dataBase64, mimeType, sceneId, label, originalName } = req.body;
    const asset = await saveUploadedImage({
      dataBase64,
      mimeType,
      sceneId,
      label,
      originalName,
    });
    res.json(asset);
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

app.post("/api/images/generate", async (req, res) => {
  try {
    const { prompt, model, aspect_ratio, resolution, sceneId, label } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: "Prompt required" });
    const asset = await generateImageAsset({ prompt, model, aspect_ratio, resolution, sceneId, label });
    res.json(asset);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/images/edit", async (req, res) => {
  try {
    const { prompt, sourceAssetId, model, aspect_ratio, resolution, sceneId, label } = req.body;
    if (!sourceAssetId) return res.status(400).json({ error: "sourceAssetId required" });
    const asset = await editImageAsset({
      prompt: prompt?.trim() || "Enhance to 2K cinematic quality, preserve composition exactly",
      sourceAssetId,
      model,
      aspect_ratio,
      resolution,
      sceneId,
      label,
    });
    res.json(asset);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/scenes/align-script", async (req, res) => {
  try {
    if (!API_KEY) return res.status(400).json({ error: "XAI_API_KEY missing in .env" });
    const { imagePrompt, dialogue, title, brief } = req.body;
    if (!imagePrompt?.trim()) {
      return res.status(400).json({ error: "imagePrompt is required" });
    }
    const aligned = await alignScenePair({
      apiBase: API_BASE,
      apiKey: API_KEY,
      brief: brief ?? "",
      title: title ?? "Scene",
      imagePrompt: imagePrompt.trim(),
      dialogue: dialogue ?? "",
    });
    res.json(aligned);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/videos/generate", async (req, res) => {
  try {
    const { prompt, sourceImageId, duration, aspect_ratio, resolution, sceneId } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: "Video prompt required" });
    if (!sourceImageId) {
      return res.status(400).json({
        error:
          "Keyframe required — grok-imagine-video-1.5-preview only supports image-to-video.",
      });
    }
    const asset = await generateVideoAsset({
      prompt,
      sourceImageId,
      duration,
      aspect_ratio,
      resolution: normalizeVideoResolution(resolution),
      sceneId,
    });
    res.json(asset);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

async function extractVideoFrameAsset(videoAssetId, sceneId, position = "last") {
  const video = await getAsset(videoAssetId);
  if (!video) throw new Error("Video not found");
  const videoPath = path.join(OUTPUT, video.filename);
  const frameId = crypto.randomUUID();
  const suffix = position === "first" ? "firstframe" : "lastframe";
  const frameName = `${frameId}_${suffix}.jpg`;
  const framePath = path.join(OUTPUT, frameName);
  const ffmpegArgs =
    position === "first"
      ? ["-y", "-i", videoPath, "-frames:v", "1", "-q:v", "2", framePath]
      : ["-y", "-sseof", "-0.25", "-i", videoPath, "-frames:v", "1", "-q:v", "2", framePath];
  await runFfmpeg(ffmpegArgs);

  return addAsset({
    id: frameId,
    type: "frame",
    filename: frameName,
    url: `/files/${frameName}`,
    remoteUrl: publicFileUrl(frameName),
    sourceAssetId: videoAssetId,
    sceneId,
    label: position === "first" ? "First frame" : "Last frame",
    createdAt: new Date().toISOString(),
  });
}

async function extractLastFrameAsset(videoAssetId, sceneId) {
  return extractVideoFrameAsset(videoAssetId, sceneId, "last");
}

async function extractFirstFrameAsset(videoAssetId, sceneId) {
  return extractVideoFrameAsset(videoAssetId, sceneId, "first");
}

app.post("/api/videos/last-frame", async (req, res) => {
  try {
    const { videoAssetId, sceneId } = req.body;
    if (!videoAssetId) return res.status(400).json({ error: "videoAssetId required" });
    const frameAsset = await extractLastFrameAsset(videoAssetId, sceneId);
    res.json({ frameAsset });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/videos/first-frame", async (req, res) => {
  try {
    const { videoAssetId, sceneId } = req.body;
    if (!videoAssetId) return res.status(400).json({ error: "videoAssetId required" });
    const frameAsset = await extractFirstFrameAsset(videoAssetId, sceneId);
    res.json({ frameAsset });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/videos/last-frame-hd", async (req, res) => {
  try {
    const { videoAssetId, sceneId, continuePrompt, model, aspect_ratio, resolution, editPrompt } =
      req.body;
    if (!videoAssetId) return res.status(400).json({ error: "videoAssetId required" });

    const video = await getAsset(videoAssetId);
    const frameAsset = await extractLastFrameAsset(videoAssetId, sceneId);

    const prompt =
      editPrompt?.trim() ||
      [
        "Upscale and restore this film frame to pristine 2K cinematic quality.",
        "Preserve exact composition, lighting, and subjects.",
        "Same image, high quality.",
        "Photorealistic, natural color, subtle film grain.",
      ].join(" ");

    const hdAsset = await editImageAsset({
      prompt,
      sourceAssetId: frameAsset.id,
      model,
      resolution: resolution || "2k",
      aspect_ratio: aspect_ratio || video.aspect_ratio || "16:9",
      sceneId,
      label: "Bridge frame HD",
    });

    res.json({ frameAsset, hdAsset });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/stitch", async (req, res) => {
  try {
    const { assetIds, fade = 0.35, clipDuration = 10 } = req.body;
    if (!assetIds?.length) return res.status(400).json({ error: "No clips" });

    const manifest = await readManifest();
    const paths = assetIds
      .map((id) => manifest.find((a) => a.id === id && a.type === "video"))
      .filter(Boolean)
      .map((v) => path.join(OUTPUT, v.filename));

    if (!paths.length) return res.status(400).json({ error: "No valid videos" });

    const outId = crypto.randomUUID();
    const outName = `${outId}_film.mp4`;
    const outPath = path.join(OUTPUT, outName);

    if (paths.length === 1) {
      await fs.copyFile(paths[0], outPath);
    } else {
      const n = paths.length;
      const inputs = paths.flatMap((p) => ["-i", p]);
      const vFilters = [];
      const aFilters = [];
      let vPrev = "[0:v]";
      let aPrev = "[0:a]";
      let offset = clipDuration - fade;
      for (let i = 1; i < n; i++) {
        const vOut = i < n - 1 ? `[v${i}]` : "[vout]";
        const aOut = i < n - 1 ? `[a${i}]` : "[aout]";
        vFilters.push(`${vPrev}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset}${vOut}`);
        aFilters.push(`${aPrev}[${i}:a]acrossfade=d=${fade}:c1=tri:c2=tri${aOut}`);
        vPrev = vOut;
        aPrev = aOut;
        offset += clipDuration - fade;
      }
      await runFfmpeg([
        "-y",
        ...inputs,
        "-filter_complex",
        [...vFilters, ...aFilters].join(";"),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outPath,
      ]);
    }

    const entry = await addAsset({
      id: outId,
      type: "film",
      filename: outName,
      url: `/files/${outName}`,
      prompt: `Film (${paths.length} clips)`,
      sourceIds: assetIds,
      createdAt: new Date().toISOString(),
    });
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.use("/files", express.static(OUTPUT));

await ensureOutput();
db.initDb(DB_PATH);
await db.migrateFromJsonFiles({
  indexFile: INDEX_FILE,
  projectsDir: PROJECTS_DIR,
  legacyProjectFile: PROJECT_FILE,
});
console.log(`Cine DB: ${DB_PATH}`);

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Cine Studio API http://127.0.0.1:${PORT}`);
  if (!API_KEY) console.warn("Warning: XAI_API_KEY not set");
});
server.on("error", (err) => {
  console.error(`[cine-media] listen failed: ${err.message}`);
  process.exit(1);
});