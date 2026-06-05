mod db;
mod jobs;

use anyhow::Context;
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, Request, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post, put},
    Router,
};
use tokio_util::io::ReaderStream;
use db::{AppSettings, Db, Project};
use jobs::{
    EnqueueJobBody, Job, JobFinishBody, JobProgressBody, QueueSettings, JOB_STATUS_CANCELLED,
    JOB_STATUS_DONE, JOB_STATUS_ERROR,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tokio::{fs, io::AsyncWriteExt, process::Command};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};

const PORT: u16 = 8792;
const MEDIA_PORT: u16 = 8793;
const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
/// JSON upload uses base64 (~4/3 overhead); Axum default body limit is 2MB.
const MAX_UPLOAD_BODY_BYTES: usize = 40 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    db: Arc<Db>,
    api_key: Option<String>,
    media_base: String,
    /// xAI API (custom DNS resolve).
    client: reqwest::Client,
    /// Local media server — no custom resolve, long timeout for generation.
    media_client: reqwest::Client,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let root = std::env::var("CINE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Users/dan/cine"));
    dotenvy::dotenv().ok();
    dotenvy::from_path(root.join(".env")).ok();

    let db = Arc::new(init_db(&root)?);
    let api_key = std::env::var("XAI_API_KEY").ok();
    let media_base = std::env::var("CINE_MEDIA_URL")
        .unwrap_or_else(|_| format!("http://127.0.0.1:{MEDIA_PORT}"));

    let client = reqwest::Client::builder()
        .resolve(
            "api.x.ai",
            SocketAddr::new(IpAddr::V4(Ipv4Addr::new(104, 18, 19, 80)), 443),
        )
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let media_client = reqwest::Client::builder()
        // Video: xAI poll + download often exceeds 10m for 2K still → 10s clip.
        .timeout(Duration::from_secs(1800))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let state = AppState {
        root: root.clone(),
        db,
        api_key,
        media_base,
        client,
        media_client,
    };

    // Media server writes assets to output/{uuid}.png (same as express.static root).
    let files_dir = root.join("output");
    fs::create_dir_all(&files_dir).await.ok();

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/config", get(config))
        .route("/api/settings", get(get_settings))
        .route("/api/settings", put(save_settings))
        .route("/api/assets", get(assets))
        .route("/api/assets/upload", post(upload_asset))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/active", get(active_project))
        .route("/api/projects", post(create_project))
        .route("/api/projects/{id}", get(get_project))
        .route("/api/projects/{id}", put(save_project))
        .route("/api/projects/{id}/activate", post(activate_project))
        .route("/api/projects/{id}", delete(delete_project))
        .route("/api/plan/scenes", post(plan_scenes))
        .route("/api/plan/scenes/stream", post(plan_scenes_stream))
        .route("/api/queue", get(get_queue))
        .route("/api/queue/config", get(get_queue_config))
        .route("/api/queue/config", put(save_queue_config))
        .route("/api/jobs", get(list_jobs))
        .route("/api/jobs", post(enqueue_job))
        .route("/api/jobs/worker/next", post(claim_job))
        .route("/api/jobs/{id}", get(get_job))
        .route("/api/jobs/{id}/cancel", post(cancel_job))
        .route("/api/jobs/{id}/progress", post(job_progress))
        .route("/api/jobs/{id}/waiting", post(job_waiting))
        .route("/api/jobs/{id}/finish", post(job_finish))
        .route("/api/jobs/{id}/resume", post(resume_job))
        .fallback(media_proxy)
        .nest_service("/files", ServeDir::new(files_dir))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BODY_BYTES))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    tracing::info!("Cine Studio v2 API http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn init_db(root: &PathBuf) -> anyhow::Result<Db> {
    db::init_db(root)
}

async fn health() -> Json<Value> {
    Json(json!({
        "ok": true,
        "app": "cine-studio-v2",
        "version": 2,
        "features": ["projects", "sqlite", "plan_scenes", "rust-core", "job_queue"],
        "port": PORT
    }))
}

async fn get_queue(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(jobs::queue_summary(&st.db)?))
}

async fn get_queue_config(State(st): State<AppState>) -> Result<Json<QueueSettings>, AppError> {
    Ok(Json(st.db.queue_settings()?))
}

async fn save_queue_config(
    State(st): State<AppState>,
    Json(settings): Json<QueueSettings>,
) -> Result<Json<Value>, AppError> {
    let saved = st.db.save_queue_settings(settings)?;
    Ok(Json(json!({ "ok": true, "settings": saved })))
}

async fn list_jobs(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let active = st.db.list_jobs(false)?;
    let recent_done = st.db.list_jobs(true)?;
    let done: Vec<&Job> = recent_done
        .iter()
        .filter(|j| j.status == JOB_STATUS_DONE || j.status == JOB_STATUS_ERROR || j.status == JOB_STATUS_CANCELLED)
        .take(50)
        .collect();
    Ok(Json(json!({
        "active": active,
        "recent": done,
        "summary": jobs::queue_summary(&st.db)?,
    })))
}

async fn get_job(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Job>, AppError> {
    let job = st
        .db
        .get_job(&id)?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Job not found"))?;
    Ok(Json(job))
}

async fn enqueue_job(
    State(st): State<AppState>,
    Json(body): Json<EnqueueJobBody>,
) -> Result<Json<Value>, AppError> {
    let project = st
        .db
        .get(&body.project_id)?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Project not found"))?;
    let label = body.label.unwrap_or_else(|| match body.kind.as_str() {
        "yolo" => format!("YOLO · {}", project.title),
        "create_all" => format!("Create all · {}", project.title),
        "plan" => format!("Plan scenes · {}", project.title),
        _ => format!("{} · {}", body.kind, project.title),
    });
    let job = st.db.enqueue_job(
        &project.id,
        &project.title,
        &body.kind,
        &label,
        body.payload,
    )?;
    tracing::info!(job_id = %job.id, kind = %job.kind, project = %project.id, "job enqueued");
    Ok(Json(json!({ "ok": true, "job": job })))
}

async fn claim_job(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let job = st.db.claim_next_job()?;
    Ok(Json(json!({ "job": job })))
}

async fn cancel_job(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let job = st
        .db
        .cancel_job(&id)?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Job not found"))?;
    Ok(Json(json!({ "ok": true, "job": job })))
}

async fn job_progress(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<JobProgressBody>,
) -> Result<Json<Value>, AppError> {
    let job = st
        .db
        .update_job_progress(&id, body.progress, body.label.as_deref(), body.progress_detail)?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Job not found"))?;
    Ok(Json(json!({ "ok": true, "job": job })))
}

async fn job_waiting(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<JobProgressBody>,
) -> Result<Json<Value>, AppError> {
    let label = body.label.as_deref().unwrap_or("Waiting for input…");
    let job = st
        .db
        .set_job_waiting(&id, label)?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Job not found"))?;
    if let Some(detail) = body.progress_detail {
        st.db.update_job_progress(&id, body.progress, None, Some(detail))?;
    }
    Ok(Json(json!({ "ok": true, "job": job })))
}

async fn job_finish(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<JobFinishBody>,
) -> Result<Json<Value>, AppError> {
    let job = st
        .db
        .finish_job(
            &id,
            &body.status,
            body.error.as_deref(),
            body.progress,
            body.progress_detail,
        )?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Job not found"))?;
    Ok(Json(json!({ "ok": true, "job": job })))
}

async fn resume_job(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let job = st
        .db
        .resume_job(&id)?
        .ok_or_else(|| AppError::msg(StatusCode::BAD_REQUEST, "Job is not waiting for input"))?;
    Ok(Json(json!({ "ok": true, "job": job })))
}

async fn get_settings(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(serde_json::to_value(st.db.app_settings()?)?))
}

async fn save_settings(
    State(st): State<AppState>,
    Json(settings): Json<AppSettings>,
) -> Result<Json<Value>, AppError> {
    let saved = st.db.save_app_settings(settings)?;
    Ok(Json(json!({ "ok": true, "settings": saved })))
}

async fn config(State(st): State<AppState>) -> Json<Value> {
    Json(json!({
        "imageModels": [
            { "id": "grok-imagine-image", "label": "Grok Imagine" },
            { "id": "grok-imagine-image-quality", "label": "Grok Imagine Quality" }
        ],
        "videoModel": "grok-imagine-video-1.5-preview",
        "imageResolutions": ["1k", "2k"],
        "videoResolution": "720p",
        "videoResolutions": ["720p", "480p"],
        "aspectRatios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
        "defaults": {
            "imageModel": "grok-imagine-image-quality",
            "imageResolution": "2k",
            "aspectRatio": "16:9",
            "videoDuration": 10,
            "videoResolution": "720p"
        },
        "hasApiKey": st.api_key.is_some(),
        "publicBase": std::env::var("PUBLIC_BASE").unwrap_or_default()
    }))
}

fn manifest_path(st: &AppState) -> PathBuf {
    st.root.join("output").join("manifest.json")
}

async fn read_manifest(st: &AppState) -> Result<Vec<Value>, AppError> {
    let path = manifest_path(st);
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).await?;
    let data: Value = serde_json::from_str(&raw).unwrap_or(json!([]));
    match data {
        Value::Array(a) => Ok(a),
        _ => Ok(vec![]),
    }
}

async fn write_manifest(st: &AppState, items: &[Value]) -> Result<(), AppError> {
    let path = manifest_path(st);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let raw = serde_json::to_string_pretty(items)?;
    fs::write(path, raw).await?;
    Ok(())
}

fn sniff_image_ext(buf: &[u8], mime: Option<&str>) -> Result<&'static str, AppError> {
    if buf.len() >= 8 && buf[0] == 0x89 && buf[1] == 0x50 && buf[2] == 0x4e && buf[3] == 0x47 {
        return Ok("png");
    }
    if buf.len() >= 3 && buf[0] == 0xff && buf[1] == 0xd8 && buf[2] == 0xff {
        return Ok("jpg");
    }
    if buf.len() >= 12 && &buf[0..4] == b"RIFF" && &buf[8..12] == b"WEBP" {
        return Ok("webp");
    }
    if buf.len() >= 6 && (&buf[0..6] == b"GIF87a" || &buf[0..6] == b"GIF89a") {
        return Ok("gif");
    }
    let mime = mime.unwrap_or("").to_lowercase();
    if mime.contains("png") {
        return Ok("png");
    }
    if mime.contains("webp") {
        return Ok("webp");
    }
    if mime.contains("gif") {
        return Ok("gif");
    }
    if mime.contains("jpeg") || mime.contains("jpg") {
        return Ok("jpg");
    }
    Err(AppError::msg(
        StatusCode::BAD_REQUEST,
        "Unsupported image type (use PNG, JPEG, WebP, or GIF)",
    ))
}

#[derive(Deserialize)]
struct UploadAssetBody {
    #[serde(rename = "dataBase64")]
    data_base64: String,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    #[serde(rename = "sceneId")]
    scene_id: Option<String>,
    label: Option<String>,
    #[serde(rename = "originalName")]
    original_name: Option<String>,
}

async fn upload_asset(
    State(st): State<AppState>,
    Json(body): Json<UploadAssetBody>,
) -> Result<Json<Value>, AppError> {
    if body.data_base64.trim().is_empty() {
        return Err(AppError::msg(StatusCode::BAD_REQUEST, "dataBase64 required"));
    }
    let bytes = B64.decode(body.data_base64.as_bytes()).map_err(|e| {
        AppError::msg(
            StatusCode::BAD_REQUEST,
            format!("Invalid base64 image data: {e}"),
        )
    })?;
    if bytes.is_empty() {
        return Err(AppError::msg(StatusCode::BAD_REQUEST, "Empty file"));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::msg(
            StatusCode::BAD_REQUEST,
            format!(
                "File too large (max {}MB)",
                MAX_UPLOAD_BYTES / (1024 * 1024)
            ),
        ));
    }

    let ext = sniff_image_ext(&bytes, body.mime_type.as_deref())?;
    let id = uuid::Uuid::new_v4().to_string();
    let filename = format!("{id}.{ext}");
    let out_dir = st.root.join("output");
    fs::create_dir_all(&out_dir).await?;
    fs::write(out_dir.join(&filename), &bytes).await?;

    let display = body
        .original_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Uploaded keyframe");
    let label = body
        .label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(display);

    let entry = json!({
        "id": id,
        "type": "image",
        "filename": filename,
        "url": format!("/files/{filename}"),
        "prompt": format!("User upload: {display}"),
        "sceneId": body.scene_id,
        "label": label,
        "source": "upload",
        "createdAt": chrono::Utc::now().to_rfc3339(),
    });

    let mut items = read_manifest(&st).await?;
    items.insert(0, entry.clone());
    write_manifest(&st, &items).await?;

    tracing::info!(asset_id = %id, bytes = bytes.len(), "asset upload saved");
    Ok(Json(entry))
}

async fn assets(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    let items = read_manifest(&st).await?;
    Ok(Json(Value::Array(items)))
}

async fn list_projects(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(serde_json::to_value(st.db.index()?)?))
}

async fn active_project(State(st): State<AppState>) -> Result<Json<Project>, AppError> {
    Ok(Json(st.db.ensure_active()?))
}

async fn get_project(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Project>, AppError> {
    st.db
        .get(&id)?
        .ok_or_else(|| AppError::msg(StatusCode::NOT_FOUND, "Project not found"))
        .map(Json)
}

#[derive(Deserialize)]
struct CreateProjectBody {
    title: Option<String>,
    logline: Option<String>,
    template: Option<String>,
}

async fn create_project(
    State(st): State<AppState>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<Project>, AppError> {
    let title = body.title.as_deref().unwrap_or("Untitled film");
    let mut p = match body.template.as_deref() {
        Some("lighthouse") => db::Db::lighthouse(title),
        _ => db::Db::blank(title),
    };
    if let Some(l) = body.logline {
        p.logline = l;
    }
    p = st.db.apply_studio_defaults(p);
    let saved = st.db.save(p)?;
    st.db.set_active(&saved.id)?;
    Ok(Json(saved))
}

async fn save_project(
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(mut project): Json<Project>,
) -> Result<Json<Value>, AppError> {
    project.id = id;
    let saved = st.db.save(project)?;
    Ok(Json(json!({ "ok": true, "project": saved })))
}

async fn activate_project(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    if st.db.get(&id)?.is_none() {
        return Err(AppError::msg(StatusCode::NOT_FOUND, "Project not found"));
    }
    st.db.set_active(&id)?;
    Ok(Json(json!({ "ok": true, "activeId": id })))
}

async fn delete_project(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let was_active = st.db.active_id()?.as_deref() == Some(id.as_str());
    if !st.db.delete(&id)? {
        return Err(AppError::msg(StatusCode::NOT_FOUND, "Project not found"));
    }
    let next = if was_active {
        let list = st.db.list()?;
        if let Some(meta) = list.first() {
            st.db.set_active(&meta.id)?;
            Some(meta.id.clone())
        } else {
            let saved = st.db.save(db::Db::blank("My first film"))?;
            st.db.set_active(&saved.id)?;
            Some(saved.id)
        }
    } else {
        st.db.active_id()?
    };
    Ok(Json(json!({ "ok": true, "activeId": next })))
}

#[derive(Deserialize)]
struct PlanBody {
    brief: String,
    mode: Option<String>,
    #[serde(rename = "shotCount")]
    shot_count: Option<u32>,
    #[serde(rename = "aspectRatio")]
    aspect_ratio: Option<String>,
    #[serde(rename = "systemRules")]
    system_rules: Option<Value>,
    continuation: Option<Value>,
    #[serde(rename = "narrativeMode")]
    narrative_mode: Option<String>,
    #[serde(rename = "narrativeModes")]
    narrative_modes: Option<Value>,
    #[serde(rename = "clipDurationSeconds")]
    clip_duration_seconds: Option<u32>,
}

async fn plan_scenes(
    State(st): State<AppState>,
    Json(body): Json<PlanBody>,
) -> Result<Json<Value>, AppError> {
    if st.api_key.is_none() {
        return Err(AppError::msg(
            StatusCode::SERVICE_UNAVAILABLE,
            "XAI_API_KEY not configured",
        ));
    }
    let script = st.root.join("scripts").join("plan-bridge.mjs");
    let req_path = st.root.join("output").join(".plan-request.json");
    let brief_len = body.brief.len();
    tracing::info!(
        brief_len,
        mode = ?body.mode,
        shot_count = ?body.shot_count,
        has_continuation = body.continuation.is_some(),
        "plan_scenes request"
    );
    let input = serde_json::to_string(&json!({
        "brief": body.brief,
        "mode": body.mode.unwrap_or_else(|| "cinematic".to_string()),
        "shotCount": body.shot_count.unwrap_or(12),
        "aspectRatio": body.aspect_ratio,
        "systemRules": body.system_rules,
        "continuation": body.continuation,
        "narrativeMode": body.narrative_mode,
        "narrativeModes": body.narrative_modes,
        "clipDurationSeconds": body.clip_duration_seconds,
    }))?;
    fs::write(&req_path, &input).await?;
    let child = Command::new("node")
        .arg(&script)
        .arg(&req_path)
        .current_dir(&st.root)
        .env("CINE_ROOT", st.root.as_os_str())
        .env("CINE_USE_CURL", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("spawn plan bridge")?;
    let out = child.wait_with_output().await?;
    let _ = fs::remove_file(&req_path).await;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        let msg = if stderr.trim().is_empty() {
            format!("Planner exited with status {}", out.status)
        } else {
            stderr.trim().to_string()
        };
        return Err(AppError::msg(StatusCode::BAD_GATEWAY, msg));
    }
    if stdout.trim().is_empty() {
        let msg = if stderr.trim().is_empty() {
            "Planner returned no output".to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(AppError::msg(StatusCode::BAD_GATEWAY, msg));
    }
    let plan: Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        AppError::msg(
            StatusCode::BAD_GATEWAY,
            format!("Planner JSON invalid: {e}. stderr: {stderr}"),
        )
    })?;
    Ok(Json(plan))
}

async fn plan_scenes_stream(
    State(st): State<AppState>,
    Json(body): Json<PlanBody>,
) -> Result<Response, AppError> {
    if st.api_key.is_none() {
        return Err(AppError::msg(
            StatusCode::SERVICE_UNAVAILABLE,
            "XAI_API_KEY not configured",
        ));
    }
    let script = st.root.join("scripts").join("plan-bridge-stream.mjs");
    let req_path = st.root.join("output").join(".plan-request.json");
    let brief_len = body.brief.len();
    tracing::info!(
        brief_len,
        mode = ?body.mode,
        shot_count = ?body.shot_count,
        has_continuation = body.continuation.is_some(),
        "plan_scenes_stream request"
    );
    let input = serde_json::to_string(&json!({
        "brief": body.brief,
        "mode": body.mode.unwrap_or_else(|| "cinematic".to_string()),
        "shotCount": body.shot_count.unwrap_or(12),
        "aspectRatio": body.aspect_ratio,
        "systemRules": body.system_rules,
        "continuation": body.continuation,
        "narrativeMode": body.narrative_mode,
        "narrativeModes": body.narrative_modes,
        "clipDurationSeconds": body.clip_duration_seconds,
    }))?;
    fs::write(&req_path, &input).await?;

    let mut child = Command::new("node")
        .arg(&script)
        .arg(&req_path)
        .current_dir(&st.root)
        .env("CINE_ROOT", st.root.as_os_str())
        .env("CINE_USE_CURL", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("spawn plan stream bridge")?;

    let stderr = child.stderr.take();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::msg(StatusCode::BAD_GATEWAY, "No planner stdout"))?;
    let req_path = req_path.clone();

    tokio::spawn(async move {
        if let Some(mut err) = stderr {
            let mut buf = String::new();
            use tokio::io::AsyncReadExt;
            let _ = err.read_to_string(&mut buf).await;
            if !buf.trim().is_empty() {
                tracing::warn!("plan stream stderr: {}", buf.trim());
            }
        }
        let _ = child.wait().await;
        let _ = fs::remove_file(&req_path).await;
    });

    let stream = ReaderStream::new(stdout);
    let body = Body::from_stream(stream);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "text/event-stream; charset=utf-8".parse().unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, "no-cache".parse().unwrap());
    headers.insert(header::CONNECTION, "keep-alive".parse().unwrap());

    Ok((StatusCode::OK, headers, body).into_response())
}

async fn media_proxy(State(st): State<AppState>, req: Request<Body>) -> impl IntoResponse {
    let uri = req.uri().to_string();
    if !uri.starts_with("/api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let url = format!("{}{}", st.media_base, uri);
    let method = req.method().clone();
    let headers = req.headers().clone();
    let body = axum::body::to_bytes(req.into_body(), 50 * 1024 * 1024)
        .await
        .unwrap_or_default();

    let mut builder = st.media_client.request(method, &url).body(body);
    for (k, v) in headers.iter() {
        if k == header::HOST
            || k == header::CONNECTION
            || k == header::TRANSFER_ENCODING
            || k == header::UPGRADE
        {
            continue;
        }
        if let Ok(s) = v.to_str() {
            builder = builder.header(k.as_str(), s);
        }
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status();
            let mut out = Response::builder().status(status);
            if let Some(ct) = resp.headers().get(header::CONTENT_TYPE) {
                out = out.header(header::CONTENT_TYPE, ct);
            }
            let bytes = resp.bytes().await.unwrap_or_default();
            out.body(Body::from(bytes)).unwrap_or_else(|_| {
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            })
        }
        Err(e) => {
            tracing::warn!(url = %url, error = %e, "media_proxy failed");
            let hint = if e.is_connect() {
                format!(
                    "Cannot reach media server at {} — run: pm2 restart cine-v2-media",
                    st.media_base
                )
            } else {
                format!("Media service: {e}")
            };
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": hint })),
            )
                .into_response()
        }
    }
}

struct AppError {
    status: StatusCode,
    message: String,
}

impl AppError {
    fn msg(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}