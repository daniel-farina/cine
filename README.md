# Cine Studio v2

Rust API + Vite React UI. Timeline drag-and-drop, unified video prompts, advanced API params.

## Dev (PM2)

```bash
cd ~/cine
cp .env.example .env   # set XAI_API_KEY=
cd backend && cargo build --release
cd ../frontend && npm install
pm2 start ecosystem.config.cjs
```

- UI: http://localhost:5180
- API: http://127.0.0.1:8792 (Rust)
- Media: http://127.0.0.1:8793 (Node sidecar — image/video/stitch)

```bash
pm2 logs cine-v2-api
pm2 restart all
```