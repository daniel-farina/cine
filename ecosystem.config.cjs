const path = require("path");
const fs = require("fs");

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const root = "/Users/dan/cine";
const sharedEnv = { CINE_ROOT: root, ...loadEnv(path.join(root, ".env")) };

module.exports = {
  apps: [
    {
      name: "cine-v2-api",
      cwd: path.join(root, "backend"),
      script: "target/release/cine-studio-api",
      env: { ...sharedEnv, RUST_LOG: "info" },
      watch: false,
    },
    {
      name: "cine-v2-media",
      cwd: root,
      script: "media-server/index.js",
      interpreter: "node",
      env: { ...sharedEnv, CINE_MEDIA_PORT: "8793" },
    },
    {
      name: "cine-v2-web",
      cwd: path.join(root, "frontend"),
      script: "npm",
      args: "run dev",
      env: { ...sharedEnv, FORCE_COLOR: "1" },
    },
    {
      name: "cine-v2-jobs",
      cwd: root,
      script: "media-server/jobWorker.js",
      interpreter: "node",
      env: { ...sharedEnv, CINE_API_URL: "http://127.0.0.1:8792" },
    },
  ],
};