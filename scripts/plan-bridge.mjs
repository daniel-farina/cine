#!/usr/bin/env node
/** Args: plan request JSON file path. stdout: plan JSON */
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

const { planScenes } = await import("../planner/scenePlan.js");
const { redactPlanRequest } = await import("../planner/planLog.js");

const apiKey = process.env.XAI_API_KEY;
if (!apiKey) {
  console.error(JSON.stringify({ error: "XAI_API_KEY missing in ~/cine/.env" }));
  process.exit(1);
}

const arg = (process.argv[2] || "").trim();
let raw = "";
if (arg) {
  const file = arg.startsWith("@") ? resolve(arg.slice(1)) : resolve(arg);
  raw = existsSync(file) ? readFileSync(file, "utf8") : arg;
} else {
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
}

let body;
try {
  body = JSON.parse(raw);
} catch (e) {
  console.error(JSON.stringify({ error: `Invalid plan request: ${e.message}` }));
  process.exit(1);
}

try {
  process.stderr.write(
    `[cine-plan] request ${JSON.stringify(redactPlanRequest(body))}\n`
  );
  const plan = await planScenes({
    apiBase: "https://api.x.ai/v1",
    apiKey,
    mode: body.mode || "cinematic",
    brief: body.brief,
    shotCount: body.shotCount ?? 12,
    aspectRatio: body.aspectRatio,
    systemRules: body.systemRules,
    continuation: body.continuation,
    narrativeMode: body.narrativeMode,
  });
  process.stderr.write(`[cine-plan] ok ${JSON.stringify({ shotCount: plan.shots?.length })}\n`);
  process.stdout.write(JSON.stringify(plan));
} catch (e) {
  process.stderr.write(`[cine-plan] fatal ${e.stack || e.message || e}\n`);
  console.error(
    JSON.stringify({
      error: e.message || String(e),
      cause: e.cause?.message || e.cause?.code || undefined,
      name: e.name,
      stack: process.env.CINE_DEBUG ? e.stack : undefined,
    })
  );
  process.exit(1);
}