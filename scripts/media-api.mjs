import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
import dotenv from "dotenv";
dotenv.config({ path: path.join(root, ".env") });

spawn("node", ["media-server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CINE_ROOT: root,
    CINE_MEDIA_PORT: "8793",
    XAI_API_KEY: process.env.XAI_API_KEY,
  },
  cwd: root,
});