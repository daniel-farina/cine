import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled film',
  logline TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db;

export function initDb(dbPath) {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

function rowToProject(row) {
  const payload = JSON.parse(row.payload);
  return {
    id: row.id,
    title: row.title,
    logline: row.logline,
    scenes: payload.scenes ?? [],
    selectedSceneId: payload.selectedSceneId ?? null,
    lookBible: payload.lookBible ?? "",
    keyframeSettings: payload.keyframeSettings ?? null,
    systemRules: payload.systemRules ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getActiveProjectId() {
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key = 'active_project_id'").get();
  return row?.value ?? null;
}

export function setActiveProjectId(id) {
  getDb()
    .prepare(
      "INSERT INTO app_meta (key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(id);
}

function firstPosterAssetId(scenes) {
  if (!Array.isArray(scenes)) return null;
  for (const s of scenes) {
    if (s?.keyframeId) return s.keyframeId;
  }
  for (const s of scenes) {
    if (s?.videoId) return s.videoId;
  }
  return null;
}

export function listProjects() {
  const rows = getDb()
    .prepare("SELECT id, title, updated_at, payload FROM projects ORDER BY updated_at DESC")
    .all();
  return rows.map((row) => {
    const payload = JSON.parse(row.payload);
    const scenes = payload.scenes ?? [];
    return {
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      sceneCount: scenes.length,
      posterAssetId: firstPosterAssetId(scenes),
    };
  });
}

export function getProjectsIndex() {
  return {
    activeId: getActiveProjectId(),
    projects: listProjects(),
  };
}

export function getProjectById(id) {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) return null;
  return rowToProject(row);
}

export function saveProject(project) {
  const now = new Date().toISOString();
  const id = project.id || crypto.randomUUID();
  const createdAt = project.createdAt || now;
  const payload = JSON.stringify({
    scenes: project.scenes ?? [],
    selectedSceneId: project.selectedSceneId ?? null,
    lookBible: project.lookBible ?? "",
    keyframeSettings: project.keyframeSettings ?? null,
    systemRules: project.systemRules ?? null,
  });

  getDb()
    .prepare(
      `INSERT INTO projects (id, title, logline, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         logline = excluded.logline,
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      project.title?.trim() || "Untitled film",
      project.logline ?? "",
      payload,
      createdAt,
      now
    );

  if (!getActiveProjectId()) setActiveProjectId(id);

  return getProjectById(id);
}

export function deleteProject(id) {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  const active = getActiveProjectId();
  if (active !== id) return active;

  const next = getDb().prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").get();
  if (next) {
    setActiveProjectId(next.id);
    return next.id;
  }
  setActiveProjectId("");
  return null;
}

export function countProjects() {
  return getDb().prepare("SELECT COUNT(*) as n FROM projects").get().n;
}

export async function migrateFromJsonFiles({ indexFile, projectsDir, legacyProjectFile }) {
  if (countProjects() > 0) return;

  const importOne = (project) => {
    saveProject(project);
  };

  try {
    const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
    if (index.projects?.length) {
      for (const meta of index.projects) {
        try {
          const raw = await fs.readFile(path.join(projectsDir, `${meta.id}.json`), "utf8");
          importOne(JSON.parse(raw));
        } catch {
          /* skip */
        }
      }
      if (index.activeId) setActiveProjectId(index.activeId);
      return;
    }
  } catch {
    /* no index */
  }

  try {
    const entries = await fs.readdir(projectsDir);
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(projectsDir, name), "utf8");
      importOne(JSON.parse(raw));
    }
    try {
      const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
      if (index.activeId) setActiveProjectId(index.activeId);
    } catch {
      /* */
    }
  } catch {
    /* no dir */
  }

  try {
    const data = JSON.parse(await fs.readFile(legacyProjectFile, "utf8"));
    if (data?.scenes?.length) {
      const now = new Date().toISOString();
      importOne({
        id: crypto.randomUUID(),
        ...data,
        createdAt: now,
        updatedAt: now,
      });
      setActiveProjectId(getDb().prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").get().id);
    }
  } catch {
    /* no legacy */
  }

  if (countProjects() > 0 && !getActiveProjectId()) {
    const first = getDb().prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").get();
    if (first) setActiveProjectId(first.id);
  }
}