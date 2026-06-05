use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::Path, sync::Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub logline: String,
    pub scenes: Value,
    #[serde(rename = "selectedSceneId")]
    pub selected_scene_id: Option<String>,
    #[serde(rename = "lookBible", default)]
    pub look_bible: String,
    #[serde(rename = "keyframeSettings", default)]
    pub keyframe_settings: Option<Value>,
    #[serde(rename = "systemRules", default)]
    pub system_rules: Option<Value>,
    #[serde(rename = "plannerMode", default)]
    pub planner_mode: Option<String>,
    #[serde(rename = "narrativeMode", default)]
    pub narrative_mode: Option<String>,
    #[serde(rename = "bridgeEditPrompt", default)]
    pub bridge_edit_prompt: Option<String>,
    #[serde(rename = "motionRules", default)]
    pub motion_rules: Option<String>,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProjectMeta {
    pub id: String,
    pub title: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "sceneCount")]
    pub scene_count: usize,
    #[serde(rename = "posterAssetId", skip_serializing_if = "Option::is_none")]
    pub poster_asset_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProjectsIndex {
    #[serde(rename = "activeId")]
    pub active_id: Option<String>,
    pub projects: Vec<ProjectMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(rename = "keyframeSettings")]
    pub keyframe_settings: Value,
    #[serde(rename = "systemRules")]
    pub system_rules: Value,
    #[serde(rename = "plannerMode", default = "default_planner_mode")]
    pub planner_mode: String,
    #[serde(rename = "narrativeMode", default = "default_narrative_mode")]
    pub narrative_mode: String,
    #[serde(rename = "defaultSceneCount", default = "default_scene_count")]
    pub default_scene_count: u32,
    #[serde(rename = "bridgeEditPrompt", default)]
    pub bridge_edit_prompt: Option<String>,
    #[serde(rename = "motionRules", default)]
    pub motion_rules: Option<String>,
}

fn default_planner_mode() -> String {
    "cinematic".to_string()
}

fn default_narrative_mode() -> String {
    "auto".to_string()
}

fn default_scene_count() -> u32 {
    12
}

pub fn default_app_settings() -> AppSettings {
    AppSettings {
        keyframe_settings: serde_json::json!({
            "aspectRatio": "16:9",
            "imageResolution": "2k",
            "imageModel": "grok-imagine-image-quality",
            "videoDuration": 10,
            "videoResolution": "720p"
        }),
        system_rules: serde_json::json!(default_system_rules()),
        planner_mode: default_planner_mode(),
        narrative_mode: default_narrative_mode(),
        default_scene_count: default_scene_count(),
        bridge_edit_prompt: None,
        motion_rules: None,
    }
}

fn default_system_rules() -> Vec<&'static str> {
    vec![]
}

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r"
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
            ",
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        Ok(self.0.lock().map_err(|e| anyhow::anyhow!("db lock: {e}"))?)
    }

    pub fn active_id(&self) -> Result<Option<String>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT value FROM app_meta WHERE key = 'active_project_id'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(row.get(0)?)
        } else {
            Ok(None)
        }
    }

    pub fn set_active(&self, id: &str) -> Result<()> {
        self.conn()?.execute(
            "INSERT INTO app_meta (key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [id],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<ProjectMeta>> {
        let conn = self.conn()?;
        let mut stmt =
            conn.prepare("SELECT id, title, updated_at, payload FROM projects ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            let payload: String = row.get(3)?;
            let payload: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            let scenes = payload.get("scenes").and_then(|s| s.as_array());
            let scene_count = scenes.map(|a| a.len()).unwrap_or(0);
            let poster = scenes.and_then(|arr| {
                arr.iter()
                    .find_map(|s| s.get("keyframeId").or_else(|| s.get("videoId")))
                    .and_then(|v| v.as_str())
                    .map(String::from)
            });
            Ok(ProjectMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                scene_count,
                poster_asset_id: poster,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn index(&self) -> Result<ProjectsIndex> {
        Ok(ProjectsIndex {
            active_id: self.active_id()?,
            projects: self.list()?,
        })
    }

    pub fn get(&self, id: &str) -> Result<Option<Project>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT * FROM projects WHERE id = ?")?;
        let mut rows = stmt.query([id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let payload: String = row.get(3)?;
        let payload: Value = serde_json::from_str(&payload)?;
        Ok(Some(Project {
            id: row.get(0)?,
            title: row.get(1)?,
            logline: row.get(2)?,
            scenes: payload
                .get("scenes")
                .cloned()
                .unwrap_or_else(|| Value::Array(vec![])),
            selected_scene_id: payload
                .get("selectedSceneId")
                .and_then(|v| v.as_str())
                .map(String::from),
            look_bible: payload
                .get("lookBible")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            keyframe_settings: payload.get("keyframeSettings").cloned(),
            system_rules: payload.get("systemRules").cloned(),
            planner_mode: payload
                .get("plannerMode")
                .and_then(|v| v.as_str())
                .map(String::from),
            narrative_mode: payload
                .get("narrativeMode")
                .and_then(|v| v.as_str())
                .map(String::from),
            bridge_edit_prompt: payload
                .get("bridgeEditPrompt")
                .and_then(|v| v.as_str())
                .map(String::from),
            motion_rules: payload
                .get("motionRules")
                .and_then(|v| v.as_str())
                .map(String::from),
            created_at: Some(row.get(4)?),
            updated_at: Some(row.get(5)?),
        }))
    }

    pub fn save(&self, mut project: Project) -> Result<Project> {
        let now = chrono::Utc::now().to_rfc3339();
        if project.id.is_empty() {
            project.id = Uuid::new_v4().to_string();
        }
        let created = project.created_at.clone().unwrap_or_else(|| now.clone());
        let payload = serde_json::json!({
            "scenes": project.scenes,
            "selectedSceneId": project.selected_scene_id,
            "lookBible": project.look_bible,
            "keyframeSettings": project.keyframe_settings,
            "systemRules": project.system_rules,
            "plannerMode": project.planner_mode,
            "narrativeMode": project.narrative_mode,
            "bridgeEditPrompt": project.bridge_edit_prompt,
            "motionRules": project.motion_rules,
        });
        self.conn()?.execute(
            r"INSERT INTO projects (id, title, logline, payload, created_at, updated_at)
              VALUES (?1,?2,?3,?4,?5,?6)
              ON CONFLICT(id) DO UPDATE SET
                title=excluded.title, logline=excluded.logline, payload=excluded.payload, updated_at=excluded.updated_at",
            params![
                project.id,
                project.title,
                project.logline,
                payload.to_string(),
                created,
                now,
            ],
        )?;
        project.updated_at = Some(now);
        project.created_at = Some(created);
        Ok(project)
    }

    pub fn delete(&self, id: &str) -> Result<bool> {
        let n = self.conn()?.execute("DELETE FROM projects WHERE id = ?", [id])?;
        Ok(n > 0)
    }

    pub fn lighthouse(title: &str) -> Project {
        let mut p = Self::blank(title);
        p.logline = "A keeper discovers an impossible light on the horizon — each scene continues from the last frame.".into();
        let s1 = Uuid::new_v4().to_string();
        let s2 = Uuid::new_v4().to_string();
        let s3 = Uuid::new_v4().to_string();
        p.scenes = serde_json::json!([
            {
                "id": s1,
                "title": "Dawn at the cliff",
                "imagePrompt": "Cinematic wide shot, lonely lighthouse on Atlantic cliff at dawn, golden mist, keeper silhouette with lantern, photorealistic 2K film still",
                "dialogue": "",
                "videoPrompt": "",
                "motionPrompt": "Slow crane down toward lighthouse, waves roll, mist drifts",
                "status": "empty"
            },
            {
                "id": s2,
                "title": "Strange horizon glow",
                "imagePrompt": "Same lighthouse, impossible teal aurora on horizon, keeper on gallery railing, cinematic suspense",
                "dialogue": "",
                "videoPrompt": "",
                "motionPrompt": "Slow push-in on keeper, aurora pulses, lens flare",
                "status": "empty"
            },
            {
                "id": s3,
                "title": "Signal answered",
                "imagePrompt": "Lighthouse lamp room at night, fresnel lens beam, keeper's hands on brass, dramatic chiaroscuro",
                "dialogue": "",
                "videoPrompt": "",
                "motionPrompt": "Lens rotates, beam sweeps, dust motes swirl",
                "status": "empty"
            }
        ]);
        p.selected_scene_id = Some(s1);
        p
    }

    pub fn blank(title: &str) -> Project {
        let id = Uuid::new_v4().to_string();
        Project {
            id: id.clone(),
            title: title.to_string(),
            logline: String::new(),
            scenes: serde_json::json!([]),
            selected_scene_id: None,
            look_bible: String::new(),
            keyframe_settings: None,
            system_rules: None,
            planner_mode: None,
            narrative_mode: None,
            bridge_edit_prompt: None,
            motion_rules: None,
            created_at: None,
            updated_at: None,
        }
    }

    pub fn app_settings(&self) -> Result<AppSettings> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT value FROM app_meta WHERE key = 'app_settings'")?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            let raw: String = row.get(0)?;
            let mut parsed: AppSettings =
                serde_json::from_str(&raw).unwrap_or_else(|_| default_app_settings());
            if let Some(ks) = parsed.keyframe_settings.as_object_mut() {
                let res = ks
                    .get("videoResolution")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if res != "720p" && res != "480p" {
                    ks.insert(
                        "videoResolution".into(),
                        Value::String("720p".into()),
                    );
                }
            }
            return Ok(parsed);
        }
        Ok(default_app_settings())
    }

    pub fn save_app_settings(&self, settings: AppSettings) -> Result<AppSettings> {
        let raw = serde_json::to_string(&settings)?;
        self.conn()?.execute(
            "INSERT INTO app_meta (key, value) VALUES ('app_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [raw],
        )?;
        Ok(settings)
    }

    pub fn apply_studio_defaults(&self, mut project: Project) -> Project {
        let settings = self.app_settings().unwrap_or_else(|_| default_app_settings());
        if project.keyframe_settings.is_none() {
            project.keyframe_settings = Some(settings.keyframe_settings.clone());
        }
        if project.system_rules.is_none() {
            project.system_rules = Some(settings.system_rules.clone());
        }
        if project.planner_mode.is_none() {
            project.planner_mode = Some(settings.planner_mode.clone());
        }
        if project.narrative_mode.is_none() {
            project.narrative_mode = Some(settings.narrative_mode.clone());
        }
        project
    }

    pub fn ensure_active(&self) -> Result<Project> {
        if let Some(id) = self.active_id()? {
            if let Some(p) = self.get(&id)? {
                return Ok(p);
            }
        }
        let p = self.apply_studio_defaults(Db::blank("My first film"));
        let saved = self.save(p)?;
        self.set_active(&saved.id)?;
        Ok(saved)
    }
}

pub fn init_db(root: &Path) -> Result<Db> {
    Db::open(&root.join("output").join("cine.db"))
}