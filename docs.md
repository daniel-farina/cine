# Cine Studio — how it works

Cine Studio v2 is a three-tier film timeline app: a **React UI**, a **Rust API** (projects, settings, job queue), and a **Node media server** (xAI image/video, ffmpeg, planner bridges). Generation work can run **in the background** so you can refresh the page or switch projects without stopping jobs.

## Architecture

```
┌─────────────────┐     /api/* (except plans)      ┌──────────────────┐
│  Vite UI :5180  │ ─────────────────────────────► │  Rust API :8792  │
│  (React)        │     projects, settings, jobs   │  SQLite cine.db  │
└────────┬────────┘                                └────────┬─────────┘
         │ poll /api/jobs every 2s                          │ proxy + plans
         │                                                  ▼
         │                                         ┌──────────────────┐
         │                                         │ Media :8793      │
         │                                         │ xAI, ffmpeg,     │
         │                                         │ asset manifest   │
         └────────────────────────────────────────►└──────────────────┘

┌─────────────────┐   claim + run pipeline        ┌──────────────────┐
│ Job worker      │ ─────────────────────────────►│ runPipeline.ts   │
│ (PM2)           │   HTTP to API + media           │ (same TS as UI)  │
└─────────────────┘                                 └──────────────────┘
```

| Service (PM2) | Port | Role |
|---------------|------|------|
| `cine-v2-web` | 5180 | React UI, proxies `/api` → 8792 |
| `cine-v2-api` | 8792 | Projects, settings, **job queue**, plan endpoints, `/files` |
| `cine-v2-media` | 8793 | Image/video generation, stitch, uploads |
| `cine-v2-jobs` | — | Background worker; claims jobs and runs `runPipeline.ts` |

Data lives under `output/`:

- `output/cine.db` — projects (JSON payload per film) + `jobs` table + `app_meta` (settings, queue limits, active project)
- `output/*.png`, `*.mp4` — generated assets
- Manifest of assets is also tracked by the media server

## Job queue (background generation)

### Why it exists

YOLO and **Create all** used to run entirely in the browser. Closing the tab or refreshing cleared progress and could leave the API wedged. Jobs are now **enqueued on the server**, executed by a **worker process**, and tracked in **SQLite** so work survives refresh and you can open another project while clips render.

### Job types

| Kind | What it does |
|------|----------------|
| `yolo` | Optionally **plan** scenes from the film brief, handle **opening upload** if needed, then **create all** (keyframes → video → bridges per scene) |
| `create_all` | Run the full generate pipeline on existing scenes (no replan) |
| `plan` | Plan scenes only (replace or append); same background worker as YOLO |

### Job statuses

| Status | Meaning |
|--------|---------|
| `queued` | Waiting for a worker slot |
| `running` | Worker is executing the pipeline |
| `waiting_input` | Paused until you upload an opening still (YOLO + upload mode) |
| `done` | Finished successfully |
| `error` | Failed (see `error` on the job) |
| `cancelled` | Stopped by user or cleanup |

### Concurrency limits

Configured in the **job bar** (expand → **Queue limits**) or via API. Stored in `app_meta` as `queue_settings`.

| Setting | Default | Range | Effect |
|---------|---------|-------|--------|
| **Concurrent jobs** | 2 | 1–5 | At most this many pipelines run at once globally |
| **Concurrent projects** | 5 | 1–5 | At most this many *different films* may have a `running` job at once |

Example: you queue 10 jobs across 8 projects with limits 2 / 5 — only **2** pipelines run at a time, and no more than **5** projects can be active simultaneously; the rest stay `queued` until a slot frees up.

The worker (`media-server/jobWorker.js`) polls `POST /api/jobs/worker/next` about every 1.5s. The API assigns the oldest eligible `queued` job if both limits allow.

### What runs the pipeline

1. Worker receives a job and spawns:  
   `npx tsx media-server/runPipeline.ts <jobId>`
2. `runPipeline.ts` patches `fetch` so `/api` and `/files` hit `http://127.0.0.1:8792`.
3. It imports the **same TypeScript** as the UI: `createAllPipeline.ts`, `effectiveSettings`, etc.
4. Progress is written back with `POST /api/jobs/:id/progress` (`progress`, `label`, `progressDetail` — same shape as the timeline K/V/B batch UI).
5. On finish: `POST /api/jobs/:id/finish` with `done`, `error`, or `cancelled`.

### Survives refresh

- Jobs are rows in `output/cine.db` (`jobs` table).
- The UI **JobQueueProvider** polls `GET /api/jobs` every **2 seconds** on every page (home, project, settings).
- Opening a project whose job is active restores **batch progress** from `progressDetail` on the timeline.
- You are **not** required to keep the project view open.

### Stale job recovery

If the API or worker crashes while a job is `running`, on next API start all `running` jobs are reset to **`queued`** with label “Resuming after restart…”. The worker picks them up again.

## UI: global job bar

- Fixed bar at the **bottom** on Home, Project, and Settings.
- Shows active jobs, progress bar, status, and per-job **Cancel**.
- Click a **project name** to switch to that film.
- **Resume after upload** appears when status is `waiting_input` (after you upload Scene 1’s opening still).

### YOLO / Create all / Plan scenes in the app

1. Click **YOLO**, **Create all**, or **Plan N scenes** → confirm.
2. App calls `POST /api/jobs` (does not block the browser on the full pipeline).
3. Status line: “Queued — progress in the job bar…”
4. You may navigate away, refresh, or open another project.
5. Timeline on that project updates from polled job progress when you return.

**Studio vs project settings** (Settings page): only **This project** affects the open film’s generation. **Studio defaults** apply to new projects only unless you save under “This project”.

## Video / keyframe handling (media server)

Large uploaded stills are a common failure mode for xAI video. Before image-to-video, the media server:

1. Resizes keyframes to a small JPEG (target ≤ ~96KB).
2. Publishes via `images/edits` to get an **xAI HTTPS URL** when possible.
3. Calls `videos/generations` with that URL (not multi‑MB base64).

Generated stills that already have an `imgen.x.ai` URL use it directly.

## Planner

- **Stream plan** (UI): `POST /api/plan/scenes/stream` → SSE from `scripts/plan-bridge-stream.mjs`.
- **Sync plan** (API / YOLO job): `POST /api/plan/scenes` → `scripts/plan-bridge.mjs`.
- Rust API spawns Node with the brief, mode, shot count, narrative mode, clip duration, and system rules.

## HTTP API (job-related)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | Active jobs + recent finished + summary |
| GET | `/api/jobs/:id` | One job |
| POST | `/api/jobs` | Enqueue `{ projectId, kind, payload?, label? }` |
| POST | `/api/jobs/:id/cancel` | Cancel |
| POST | `/api/jobs/:id/resume` | Requeue from `waiting_input` |
| GET | `/api/queue/config` | `{ maxConcurrentJobs, maxConcurrentProjects }` |
| PUT | `/api/queue/config` | Update limits |
| POST | `/api/jobs/worker/next` | Worker claims next job (internal) |
| POST | `/api/jobs/:id/progress` | Worker progress update (internal) |
| POST | `/api/jobs/:id/finish` | Worker completion (internal) |

## Operations

```bash
cd ~/cine
pm2 start ecosystem.config.cjs    # api, media, web, jobs
pm2 restart cine-v2-api cine-v2-media cine-v2-jobs cine-v2-web
pm2 logs cine-v2-jobs
```

Health checks:

```bash
curl http://127.0.0.1:8792/api/health
curl http://127.0.0.1:8793/api/health
```

Inspect queue in SQLite:

```bash
sqlite3 output/cine.db "SELECT status, label, progress FROM jobs ORDER BY created_at DESC LIMIT 10;"
```

## What is still client-side

- **Per-scene Generate** in the inspector — immediate API calls, not queued.
- **Stitch final movie** — runs when you click it (not queued yet).

These can be moved into the job queue later using the same `POST /api/jobs` pattern.

## Environment

- `XAI_API_KEY` in `.env` (required for generation).
- `CINE_ROOT` — repo root (default `~/cine`).
- `CINE_API_URL` — worker → API (default `http://127.0.0.1:8792`).
- `CINE_MEDIA_URL` — default `http://127.0.0.1:8793`.

## Related files

| Area | Path |
|------|------|
| Job DB + API routes | `backend/src/jobs.rs`, `backend/src/main.rs` |
| Worker loop | `media-server/jobWorker.js` |
| Pipeline runner | `media-server/runPipeline.ts` |
| UI queue | `frontend/src/JobQueueContext.tsx`, `JobQueueBar.tsx` |
| Enqueue from app | `frontend/src/App.tsx` (`runYolo`, `runCreateAll`) |
| Client pipeline (shared) | `frontend/src/createAllPipeline.ts` |
| PM2 | `ecosystem.config.cjs` |