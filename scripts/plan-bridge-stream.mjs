#!/usr/bin/env node
/** Args: plan request JSON file path. stdout: SSE (text/event-stream). */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const root = process.env.CINE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: resolve(root, ".env") });

if (process.env.CINE_USE_CURL === "1") {
  const { createCurlFetch } = await import("./xai-curl-fetch.mjs");
  globalThis.fetch = createCurlFetch();
}

const { planScenesStream } = await import("../planner/scenePlan.js");
const { redactPlanRequest } = await import("../planner/planLog.js");

const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  process.stdout.write(
    `event: error\ndata: ${JSON.stringify({ message: "XAI_API_KEY missing in ~/cine/.env" })}\n\n`
  );
  process.exit(1);
}

const arg = (process.argv[2] || "").trim();
let raw = "";
if (arg) {
  const file = arg.startsWith("@") ? resolve(arg.slice(1)) : resolve(arg);
  raw = existsSync(file) ? readFileSync(file, "utf8") : arg;
}

let body;
try {
  body = JSON.parse(raw);
} catch (e) {
  process.stdout.write(
    `event: error\ndata: ${JSON.stringify({ message: `Invalid plan request: ${e.message}` })}\n\n`
  );
  process.exit(1);
}

let clientGone = false;
const markClientGone = () => {
  clientGone = true;
};
process.stdout.on("error", (err) => {
  if (err?.code === "EPIPE") markClientGone();
});
process.on("uncaughtException", (err) => {
  if (err?.code === "EPIPE") {
    markClientGone();
    return;
  }
  throw err;
});

const send = (event, payload) => {
  if (clientGone || !process.stdout.writable) return false;
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  try {
    process.stdout.write(chunk);
    return true;
  } catch (err) {
    if (err?.code === "EPIPE") {
      markClientGone();
      return false;
    }
    throw err;
  }
};

try {
  process.stderr.write(
    `[cine-plan] request ${JSON.stringify(redactPlanRequest(body))}\n`
  );
  await planScenesStream({
    apiBase: "https://api.x.ai/v1",
    apiKey,
    mode: body.mode || "cinematic",
    brief: body.brief,
    shotCount: body.shotCount ?? 12,
    aspectRatio: body.aspectRatio,
    systemRules: body.systemRules,
    continuation: body.continuation,
    send,
  });
  send("done", {});
} catch (e) {
  process.stderr.write(`[cine-plan] fatal ${e.stack || e.message || e}\n`);
  send("error", { message: e.message || String(e) });
  process.exit(1);
}