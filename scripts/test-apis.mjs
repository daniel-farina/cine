#!/usr/bin/env node
/**
 * Smoke-test Cine Studio v2 API (Rust :8792) and file serving.
 * Usage: node scripts/test-apis.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://127.0.0.1:8792";

const results = [];

async function req(method, path, body) {
  const url = `${BASE}${path}`;
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json, headers: res.headers };
}

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`Testing ${BASE}\n`);

  let health = await req("GET", "/api/health");
  record("GET /api/health", health.ok && health.json?.ok, String(health.status));

  let config = await req("GET", "/api/config");
  record(
    "GET /api/config",
    config.ok && config.json?.imageModels?.length,
    config.json?.hasApiKey ? "hasApiKey" : "no API key"
  );

  let settings = await req("GET", "/api/settings");
  record(
    "GET /api/settings",
    settings.ok && Array.isArray(settings.json?.systemRules),
    `${settings.json?.systemRules?.length ?? 0} rules`
  );

  let projects = await req("GET", "/api/projects");
  record(
    "GET /api/projects",
    projects.ok && Array.isArray(projects.json?.projects),
    `${projects.json?.projects?.length ?? 0} projects`
  );

  let active = await req("GET", "/api/projects/active");
  record(
    "GET /api/projects/active",
    active.ok && active.json?.id,
    active.json?.title
  );

  const projectId = active.json?.id;
  if (projectId) {
    let one = await req("GET", `/api/projects/${projectId}`);
    record("GET /api/projects/:id", one.ok && one.json?.id === projectId);
  }

  let assets = await req("GET", "/api/assets");
  const assetList = assets.ok && Array.isArray(assets.json) ? assets.json : [];
  record("GET /api/assets", assets.ok, `${assetList.length} assets`);

  const imageAsset = assetList.find((a) => a.type === "image" && a.filename);
  if (imageAsset) {
    const filePath = imageAsset.url?.startsWith("http")
      ? new URL(imageAsset.url).pathname
      : imageAsset.url;
    const fileRes = await fetch(`${BASE}${filePath}`);
    const ct = fileRes.headers.get("content-type") || "";
    record(
      `GET ${filePath}`,
      fileRes.ok && ct.includes("image"),
      `${fileRes.status} ${ct}`
    );
  } else {
    record("GET /files/{asset}", false, "no image asset in manifest");
  }

  const testFile = "78faf76c-9d9f-47f0-bb03-2c36cf28c6bb.png";
  const known = await fetch(`${BASE}/files/${testFile}`);
  record(
    `GET /files/${testFile.slice(0, 8)}…`,
    known.ok,
    known.ok ? known.headers.get("content-type") : String(known.status)
  );

  let create = await req("POST", "/api/projects", {
    title: `API test ${Date.now()}`,
    template: "blank",
  });
  record("POST /api/projects", create.ok && create.json?.id, create.json?.id?.slice(0, 8));

  if (create.ok && create.json?.id) {
    const nid = create.json.id;
    let act = await req("POST", `/api/projects/${nid}/activate`);
    record("POST /api/projects/:id/activate", act.ok);

    create.json.title = "API test renamed";
    let put = await req("PUT", `/api/projects/${nid}`, create.json);
    record("PUT /api/projects/:id", put.ok && put.json?.ok);

    let del = await req("DELETE", `/api/projects/${nid}`);
    record("DELETE /api/projects/:id", del.ok && del.json?.ok);
  }

  if (config.json?.hasApiKey && projectId) {
    const sceneId = active.json?.scenes?.[0]?.id;
    if (sceneId) {
      console.log("\nLive generation (requires XAI_API_KEY)…");
      let img = await req("POST", "/api/images/generate", {
        prompt: "A single red apple on a wooden table, photorealistic still, 2K",
        sceneId,
        label: "api-test",
        aspect_ratio: "16:9",
        resolution: "2k",
        model: "grok-imagine-image-quality",
      });
      record(
        "POST /api/images/generate",
        img.ok && img.json?.url,
        img.ok ? img.json.url : img.json?.error || img.status
      );
      if (img.ok && img.json?.url) {
        const p = img.json.url.startsWith("http") ? new URL(img.json.url).pathname : img.json.url;
        const fr = await fetch(`${BASE}${p}`);
        record(`GET generated ${p}`, fr.ok, String(fr.status));
      }
    }
  } else {
    record("POST /api/images/generate", true, "skipped (no API key)");
  }

  if (projectId) {
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let up = await req("POST", "/api/assets/upload", {
      dataBase64: tinyPng,
      mimeType: "image/png",
      sceneId: active.json?.scenes?.[0]?.id,
      label: "test-upload",
      originalName: "pixel.png",
    });
    record("POST /api/assets/upload", up.ok && up.json?.url, up.json?.url);
    if (up.ok && up.json?.url) {
      const p = up.json.url.startsWith("http") ? new URL(up.json.url).pathname : up.json.url;
      const fr = await fetch(`${BASE}${p}`);
      record(`GET uploaded ${p}`, fr.ok, String(fr.status));
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});