#!/usr/bin/env node
/**
 * Smoke-test Cine media + xAI paths used by YOLO (image → video).
 * Usage: node scripts/test-cine-apis.mjs [--skip-video-poll]
 */
import { config } from "dotenv";
import { createCurlFetch } from "./xai-curl-fetch.mjs";

config({ path: new URL("../.env", import.meta.url).pathname });

const MEDIA = process.env.CINE_MEDIA_URL || "http://127.0.0.1:8793";
const API = process.env.CINE_API_URL || "http://127.0.0.1:8792";
const skipPoll = process.argv.includes("--skip-video-poll");

let failed = 0;

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`✓ ${name} (${Date.now() - t0}ms)`, typeof out === "string" ? out.slice(0, 72) : "");
    return out;
  } catch (e) {
    failed++;
    console.error(`✗ ${name} (${Date.now() - t0}ms)`, e.message || e);
    return null;
  }
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// xAI direct (curl)
const key = process.env.XAI_API_KEY;
if (key) {
  globalThis.fetch = createCurlFetch();
  await check("xAI text-to-image", async () => {
    const d = await jsonFetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt: "minimal blue circle on white",
        aspect_ratio: "1:1",
        resolution: "1k",
        response_format: "url",
      }),
    });
    return d.data?.[0]?.url;
  });
}

await check("media health", () => jsonFetch(`${MEDIA}/api/health`));
await check("api health", () => jsonFetch(`${API}/api/health`));

const img = await check("media image generate", () =>
  jsonFetch(`${MEDIA}/api/images/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "a single red apple on white table, product photo",
      sceneId: "api-test",
      label: "API test still",
      aspect_ratio: "16:9",
      resolution: "1k",
    }),
  })
);

if (img?.id) {
  if (skipPoll) {
    await check("media video start (no poll)", async () => {
      console.log("  (skipped full poll — run without --skip-video-poll for E2E)");
      return img.id;
    });
  } else {
    await check("media video generate (YOLO path)", () =>
      jsonFetch(`${MEDIA}/api/videos/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "very subtle natural motion, locked camera",
          sourceImageId: img.id,
          duration: 5,
          aspect_ratio: "16:9",
          resolution: "720p",
          sceneId: "api-test",
        }),
      })
    );
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);