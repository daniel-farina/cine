# Cine Studio

AI film timeline studio: plan multi-scene films, generate keyframes and clips with [xAI Grok Imagine](https://docs.x.ai), stitch exports with ffmpeg, or use **Quick Builder** for one-off text/image-to-video clips.

**License:** [MIT](LICENSE)

## What you need

| Requirement | Notes |
|-------------|--------|
| **Node.js** 20+ | Media server, frontend, job worker |
| **Rust** (stable) + **Cargo** | API server (`backend/`) |
| **ffmpeg** | On your `PATH` (stitching, frame extract) |
| **xAI API key** | [Create one](https://console.x.ai/) — billed to your account |
| **PM2** (recommended) | `npm install -g pm2` — runs all services together |

Optional: **Graphite / gh** only for development workflows.

## Quick start (local)

```bash
git clone https://github.com/daniel-farina/cine.git
cd cine

# Secrets (never commit this file)
cp .env.example .env
# Edit .env and set:
#   XAI_API_KEY=xai-...

# Root deps (media server + worker)
npm install

# Rust API
cd backend && cargo build --release && cd ..

# React UI
cd frontend && npm install && cd ..

# Start everything (from repo root)
pm2 start ecosystem.config.cjs
```

Open **http://localhost:5180**

| Service | URL |
|---------|-----|
| Web UI | http://localhost:5180 |
| Rust API | http://127.0.0.1:8792 |
| Media (xAI, ffmpeg) | http://127.0.0.1:8793 |

```bash
pm2 status
pm2 logs
pm2 restart all
pm2 stop all
```

### Without PM2 (manual)

Four terminals from the repo root:

```bash
# 1 — Media
CINE_ROOT=$PWD node media-server/index.js

# 2 — Job worker (background queue)
CINE_ROOT=$PWD CINE_API_URL=http://127.0.0.1:8792 node media-server/jobWorker.js

# 3 — Rust API
cd backend && CINE_ROOT=.. ./target/release/cine-studio-api

# 4 — Frontend
cd frontend && npm run dev
```

## Features

- **Projects** — multi-scene timeline, planner, YOLO batch generate, stitch final film
- **Quick Builder** — parallel still/video clips, live per-clip progress, optional still-only then video later
- **Job queue** — generation continues across refresh; switch projects while jobs run
- **Settings** — studio defaults + per-film overrides (models, duration, planner mode)

## Configuration

All secrets go in `.env` (see `.env.example`):

```bash
XAI_API_KEY=xai-your-key-here

# Optional
# CINE_ROOT=/absolute/path/to/cine
# CINE_MEDIA_PORT=8793
# CINE_PUBLIC_URL=https://your-host/files   # if media must reach xAI via public URL
```

`ecosystem.config.cjs` reads `.env` from the repo root and sets `CINE_ROOT` automatically.

## Data on disk (not in git)

Generated assets and databases live under `output/` (gitignored):

- Images / videos / stitched films
- `output/cine.db` — projects and job queue (Rust)
- `output/manifest.json` — media asset index (Node)

Delete `output/` anytime to reset local media (keep projects in DB unless you remove the db file).

## Development

```bash
# Frontend production build
cd frontend && npm run build

# API smoke tests (needs .env + running media)
node scripts/test-apis.mjs
```

## Repository hygiene

This repo **does not** include:

- `.env` or API keys (use `.env.example` only)
- Generated videos/images under `output/`
- `node_modules/`, `backend/target/`, `frontend/dist/`

Do not commit media or secrets. If you fork, rotate any key that was ever pasted into a file.

## Structure

```
cine/
├── backend/          # Rust Axum API (projects, settings, jobs)
├── frontend/         # Vite + React UI
├── media-server/     # Express + xAI + ffmpeg
├── planner/          # Scene planning prompts/logic
├── scripts/          # Dev helpers
├── output/           # Local runtime data (gitignored)
├── ecosystem.config.cjs
└── .env.example
```

## Troubleshooting

- **“XAI_API_KEY missing”** — create `.env` from `.env.example` and restart PM2.
- **Video stitch fails** — install ffmpeg: `brew install ffmpeg` (macOS) or your distro package.
- **Port in use** — change `CINE_MEDIA_PORT` or stop other processes on 8792/8793/5180.
- **Stale jobs after crash** — API requeues on startup; or inspect `output/cine.db` with sqlite3.

## Author

[daniel-farina](https://github.com/daniel-farina)