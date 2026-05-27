use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;

use crate::ai::error::AIError;
use crate::ai::providers::build_default_providers;
use crate::ai::{
    GenerateRequest, ProviderRegistry, ProviderRuntimeConfig, ProviderTaskHandle, ProviderTaskPollResult,
    ProviderTaskSubmission,
};

static REGISTRY: std::sync::OnceLock<ProviderRegistry> = std::sync::OnceLock::new();
static ACTIVE_NON_RESUMABLE_JOB_IDS: std::sync::OnceLock<Arc<RwLock<HashSet<String>>>> =
    std::sync::OnceLock::new();

fn get_registry() -> &'static ProviderRegistry {
    REGISTRY.get_or_init(|| {
        let mut registry = ProviderRegistry::new();
        for provider in build_default_providers() {
            registry.register_provider(provider);
        }
        registry
    })
}

fn active_non_resumable_job_ids() -> &'static Arc<RwLock<HashSet<String>>> {
    ACTIVE_NON_RESUMABLE_JOB_IDS.get_or_init(|| Arc::new(RwLock::new(HashSet::new())))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateRequestDto {
    pub prompt: String,
    pub model: String,
    pub size: String,
    pub aspect_ratio: String,
    pub reference_images: Option<Vec<String>>,
    pub extra_params: Option<HashMap<String, Value>>,
}

#[derive(Debug, Serialize)]
pub struct GenerationJobStatusDto {
    pub job_id: String,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug)]
struct GenerationJobRecord {
    job_id: String,
    provider_id: String,
    status: String,
    resumable: bool,
    external_task_id: Option<String>,
    external_task_meta_json: Option<String>,
    result: Option<String>,
    error: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("projects.db"))
}

fn ensure_generation_jobs_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_generation_jobs (
          job_id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          status TEXT NOT NULL,
          resumable INTEGER NOT NULL DEFAULT 0,
          external_task_id TEXT,
          external_task_meta_json TEXT,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_status ON ai_generation_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_updated_at ON ai_generation_jobs(updated_at DESC);
        "#,
    )
    .map_err(|e| format!("Failed to initialize ai_generation_jobs table: {}", e))?;

    Ok(())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set journal_mode=WAL: {}", e))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("Failed to set synchronous=NORMAL: {}", e))?;
    conn.pragma_update(None, "temp_store", "MEMORY")
        .map_err(|e| format!("Failed to set temp_store=MEMORY: {}", e))?;
    conn.busy_timeout(Duration::from_millis(3000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    ensure_generation_jobs_table(&conn)?;
    Ok(conn)
}

fn insert_generation_job(
    app: &AppHandle,
    job_id: &str,
    provider_id: &str,
    status: &str,
    resumable: bool,
    external_task_id: Option<&str>,
    external_task_meta_json: Option<&str>,
    result: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = open_db(app)?;
    let now = now_ms();
    conn.execute(
        r#"
        INSERT INTO ai_generation_jobs (
          job_id,
          provider_id,
          status,
          resumable,
          external_task_id,
          external_task_meta_json,
          result,
          error,
          created_at,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
        params![
            job_id,
            provider_id,
            status,
            if resumable { 1_i64 } else { 0_i64 },
            external_task_id,
            external_task_meta_json,
            result,
            error,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert generation job: {}", e))?;
    Ok(())
}

fn update_generation_job(
    app: &AppHandle,
    job_id: &str,
    status: &str,
    result: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        r#"
        UPDATE ai_generation_jobs
        SET
          status = ?1,
          result = ?2,
          error = ?3,
          updated_at = ?4
        WHERE job_id = ?5
        "#,
        params![status, result, error, now_ms(), job_id],
    )
    .map_err(|e| format!("Failed to update generation job: {}", e))?;
    Ok(())
}

fn touch_generation_job(app: &AppHandle, job_id: &str) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE ai_generation_jobs SET updated_at = ?1 WHERE job_id = ?2",
        params![now_ms(), job_id],
    )
    .map_err(|e| format!("Failed to touch generation job: {}", e))?;
    Ok(())
}

fn get_generation_job(app: &AppHandle, job_id: &str) -> Result<Option<GenerationJobRecord>, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              job_id,
              provider_id,
              status,
              resumable,
              external_task_id,
              external_task_meta_json,
              result,
              error
            FROM ai_generation_jobs
            WHERE job_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|e| format!("Failed to prepare generation job query: {}", e))?;

    let result = stmt.query_row(params![job_id], |row| {
        Ok(GenerationJobRecord {
            job_id: row.get(0)?,
            provider_id: row.get(1)?,
            status: row.get(2)?,
            resumable: row.get::<_, i64>(3)? != 0,
            external_task_id: row.get(4)?,
            external_task_meta_json: row.get(5)?,
            result: row.get(6)?,
            error: row.get(7)?,
        })
    });

    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load generation job: {}", error)),
    }
}

fn dto_from_record(record: &GenerationJobRecord) -> GenerationJobStatusDto {
    GenerationJobStatusDto {
        job_id: record.job_id.clone(),
        status: record.status.clone(),
        result: record.result.clone(),
        error: record.error.clone(),
    }
}

#[tauri::command]
pub async fn set_api_key(provider: String, api_key: String) -> Result<(), String> {
    set_provider_config(
        provider,
        ProviderRuntimeConfig {
            api_key: Some(api_key),
            base_url: None,
            model: None,
            prefer_async: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn set_provider_config(
    provider: String,
    config: ProviderRuntimeConfig,
) -> Result<(), String> {
    info!("Setting runtime config for provider: {}", provider);

    let registry = get_registry();
    let resolved_provider = registry
        .get_provider(provider.as_str())
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    resolved_provider
        .set_runtime_config(config)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn submit_generate_image_job(
    app: AppHandle,
    request: GenerateRequestDto,
) -> Result<String, String> {
    info!("Submitting generation job with model: {}", request.model);

    let registry = get_registry();
    let provider = registry
        .resolve_provider_for_model(&request.model)
        .or_else(|| registry.get_default_provider())
        .cloned()
        .ok_or_else(|| "Provider not found".to_string())?;

    let req = GenerateRequest {
        prompt: request.prompt,
        model: request.model,
        size: request.size,
        aspect_ratio: request.aspect_ratio,
        reference_images: request.reference_images,
        extra_params: request.extra_params,
    };

    let job_id = Uuid::new_v4().to_string();
    let provider_id = provider.name().to_string();

    if provider.supports_task_resume() {
        match provider.submit_task(req).await.map_err(|e| e.to_string())? {
            ProviderTaskSubmission::Succeeded(image_source) => {
                insert_generation_job(
                    &app,
                    job_id.as_str(),
                    provider_id.as_str(),
                    "succeeded",
                    true,
                    None,
                    None,
                    Some(image_source.as_str()),
                    None,
                )?;
            }
            ProviderTaskSubmission::Queued(handle) => {
                let meta_json = handle
                    .metadata
                    .as_ref()
                    .and_then(|value| serde_json::to_string(value).ok());
                insert_generation_job(
                    &app,
                    job_id.as_str(),
                    provider_id.as_str(),
                    "running",
                    true,
                    Some(handle.task_id.as_str()),
                    meta_json.as_deref(),
                    None,
                    None,
                )?;
            }
        }
        return Ok(job_id);
    }

    insert_generation_job(
        &app,
        job_id.as_str(),
        provider_id.as_str(),
        "running",
        false,
        None,
        None,
        None,
        None,
    )?;
    {
        let mut active_set = active_non_resumable_job_ids().write().await;
        active_set.insert(job_id.clone());
    }

    let app_handle = app.clone();
    let spawned_job_id = job_id.clone();
    let spawned_provider = provider.clone();
    tauri::async_runtime::spawn(async move {
        let result = spawned_provider.generate(req).await;
        let update_result = match result {
            Ok(image_source) => update_generation_job(
                &app_handle,
                spawned_job_id.as_str(),
                "succeeded",
                Some(image_source.as_str()),
                None,
            ),
            Err(error) => {
                let message = error.to_string();
                update_generation_job(
                    &app_handle,
                    spawned_job_id.as_str(),
                    "failed",
                    None,
                    Some(message.as_str()),
                )
            }
        };
        if let Err(error) = update_result {
            info!("Failed to update non-resumable generation job: {}", error);
        }
        let mut active_set = active_non_resumable_job_ids().write().await;
        active_set.remove(spawned_job_id.as_str());
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn get_generate_image_job(
    app: AppHandle,
    job_id: String,
) -> Result<GenerationJobStatusDto, String> {
    let maybe_record = get_generation_job(&app, job_id.as_str())?;
    let Some(mut record) = maybe_record else {
        return Ok(GenerationJobStatusDto {
            job_id,
            status: "not_found".to_string(),
            result: None,
            error: Some("job not found".to_string()),
        });
    };

    if record.status == "succeeded" || record.status == "failed" {
        return Ok(dto_from_record(&record));
    }

    if !record.resumable {
        let is_active = {
            let active_set = active_non_resumable_job_ids().read().await;
            active_set.contains(record.job_id.as_str())
        };
        if is_active {
            let _ = touch_generation_job(&app, record.job_id.as_str());
            return Ok(dto_from_record(&record));
        }

        let interrupted_message = "job interrupted by app restart".to_string();
        update_generation_job(
            &app,
            record.job_id.as_str(),
            "failed",
            None,
            Some(interrupted_message.as_str()),
        )?;
        record.status = "failed".to_string();
        record.error = Some(interrupted_message);
        return Ok(dto_from_record(&record));
    }

    let provider = get_registry()
        .get_provider(record.provider_id.as_str())
        .cloned()
        .ok_or_else(|| format!("Provider not found for job: {}", record.provider_id))?;

    let Some(task_id) = record.external_task_id.clone() else {
        let message = "missing external task id".to_string();
        update_generation_job(
            &app,
            record.job_id.as_str(),
            "failed",
            None,
            Some(message.as_str()),
        )?;
        record.status = "failed".to_string();
        record.error = Some(message);
        return Ok(dto_from_record(&record));
    };

    let task_meta = record
        .external_task_meta_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());

    match provider
        .poll_task(ProviderTaskHandle {
            task_id,
            metadata: task_meta,
        })
        .await
    {
        Ok(ProviderTaskPollResult::Running) => {
            let _ = touch_generation_job(&app, record.job_id.as_str());
            Ok(dto_from_record(&record))
        }
        Ok(ProviderTaskPollResult::Succeeded(image_source)) => {
            update_generation_job(
                &app,
                record.job_id.as_str(),
                "succeeded",
                Some(image_source.as_str()),
                None,
            )?;
            Ok(GenerationJobStatusDto {
                job_id: record.job_id,
                status: "succeeded".to_string(),
                result: Some(image_source),
                error: None,
            })
        }
        Ok(ProviderTaskPollResult::Failed(message)) => {
            update_generation_job(
                &app,
                record.job_id.as_str(),
                "failed",
                None,
                Some(message.as_str()),
            )?;
            Ok(GenerationJobStatusDto {
                job_id: record.job_id,
                status: "failed".to_string(),
                result: None,
                error: Some(message),
            })
        }
        Err(AIError::TaskFailed(message)) => {
            update_generation_job(
                &app,
                record.job_id.as_str(),
                "failed",
                None,
                Some(message.as_str()),
            )?;
            Ok(GenerationJobStatusDto {
                job_id: record.job_id,
                status: "failed".to_string(),
                result: None,
                error: Some(message),
            })
        }
        Err(error) => Ok(GenerationJobStatusDto {
            job_id: record.job_id,
            status: "running".to_string(),
            result: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn generate_image(request: GenerateRequestDto) -> Result<String, String> {
    info!("Generating image with model: {}", request.model);

    let registry = get_registry();
    let provider = registry
        .resolve_provider_for_model(&request.model)
        .or_else(|| registry.get_default_provider())
        .ok_or_else(|| "Provider not found".to_string())?;

    let req = GenerateRequest {
        prompt: request.prompt,
        model: request.model,
        size: request.size,
        aspect_ratio: request.aspect_ratio,
        reference_images: request.reference_images,
        extra_params: request.extra_params,
    };

    provider.generate(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models() -> Result<Vec<String>, String> {
    Ok(get_registry().list_models())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessageDto {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatCompletionRequestDto {
    pub messages: Vec<ChatMessageDto>,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
}

fn translate_openai_to_claude(messages: &mut serde_json::Value) -> Option<String> {
    let mut system_prompts = Vec::new();
    let mut clean_messages = Vec::new();

    if let Some(arr) = messages.as_array_mut() {
        for msg in arr {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role == "system" {
                // 收集 system 提示词内容并从消息列表中过滤剥离以彻底满足 Claude 规范
                if let Some(content) = msg.get("content") {
                    if let Some(txt) = content.as_str() {
                        system_prompts.push(txt.to_string());
                    } else if let Some(parts) = content.as_array() {
                        let mut t = String::new();
                        for part in parts {
                            if part.get("type").and_then(|x| x.as_str()) == Some("text") {
                                if let Some(txt) = part.get("text").and_then(|x| x.as_str()) {
                                    t.push_str(txt);
                                }
                            }
                        }
                        if !t.is_empty() {
                            system_prompts.push(t);
                        }
                    }
                }
            } else {
                // 这是一般的 user 或 assistant 对话，翻译 base64 多模态大图
                let mut msg_clone = msg.clone();
                if let Some(content) = msg_clone.get_mut("content") {
                    if let Some(parts) = content.as_array_mut() {
                        for part in parts {
                            if part.get("type").and_then(|t| t.as_str()) == Some("image_url") {
                                if let Some(image_url_obj) = part.get("image_url") {
                                    if let Some(url_str) = image_url_obj.get("url").and_then(|u| u.as_str()) {
                                        if url_str.starts_with("data:") && url_str.contains(";base64,") {
                                            let parts_split: Vec<&str> = url_str.split(";base64,").collect();
                                            if parts_split.len() == 2 {
                                                let prefix = parts_split[0];
                                                let base64_data = parts_split[1];
                                                let media_type = prefix.trim_start_matches("data:");
                                                *part = serde_json::json!({
                                                    "type": "image",
                                                    "source": {
                                                        "type": "base64",
                                                        "media_type": media_type,
                                                        "data": base64_data
                                                    }
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                clean_messages.push(msg_clone);
            }
        }
    }

    *messages = serde_json::Value::Array(clean_messages);

    if !system_prompts.is_empty() {
        Some(system_prompts.join("\n\n"))
    } else {
        None
    }
}

fn translate_openai_to_gemini(
    messages: &[ChatMessageDto],
) -> (serde_json::Value, Option<serde_json::Value>) {
    let mut contents = Vec::new();
    let mut system_instruction = None;
    let mut system_prompts = Vec::new();

    // 首先收集所有 system 消息，实现极佳的汇总
    for msg in messages {
        if msg.role == "system" {
            let text_content = if msg.content.is_string() {
                msg.content.as_str().unwrap_or("").to_string()
            } else if let Some(arr) = msg.content.as_array() {
                let mut t = String::new();
                for item in arr {
                    if item.get("type").and_then(|x| x.as_str()) == Some("text") {
                        if let Some(txt) = item.get("text").and_then(|x| x.as_str()) {
                            t.push_str(txt);
                        }
                    }
                }
                t
            } else {
                msg.content.to_string()
            };
            if !text_content.is_empty() {
                system_prompts.push(text_content);
            }
        }
    }

    let combined_system_prompt = if !system_prompts.is_empty() {
        let joined = system_prompts.join("\n\n");
        system_instruction = Some(serde_json::json!({
            "parts": [
                {
                    "text": joined
                }
            ]
        }));
        Some(joined)
    } else {
        None
    };

    // 接下来映射非 system 的对话消息
    for msg in messages {
        if msg.role == "system" {
            continue;
        }

        let role = if msg.role == "assistant" { "model" } else { "user" };
        let mut parts = Vec::new();

        if msg.content.is_string() {
            parts.push(serde_json::json!({
                "text": msg.content.as_str().unwrap_or("")
            }));
        } else if let Some(arr) = msg.content.as_array() {
            for item in arr {
                let part_type = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
                if part_type == "text" {
                    if let Some(txt) = item.get("text").and_then(|x| x.as_str()) {
                        parts.push(serde_json::json!({
                            "text": txt
                        }));
                    }
                } else if part_type == "image_url" {
                    if let Some(image_url_obj) = item.get("image_url") {
                        if let Some(url_str) = image_url_obj.get("url").and_then(|u| u.as_str()) {
                            if url_str.starts_with("data:") && url_str.contains(";base64,") {
                                let parts_split: Vec<&str> = url_str.split(";base64,").collect();
                                if parts_split.len() == 2 {
                                    let prefix = parts_split[0];
                                    let base64_data = parts_split[1];
                                    let media_type = prefix.trim_start_matches("data:");
                                    parts.push(serde_json::json!({
                                        "inline_data": {
                                            "mime_type": media_type,
                                            "data": base64_data
                                        }
                                    }));
                                }
                            }
                        }
                    }
                } else if part_type == "video_data" {
                    // 视频多模态支持：将 base64 视频数据转换为 Gemini inline_data 格式
                    if let Some(video_data_obj) = item.get("video_data") {
                        if let Some(url_str) = video_data_obj.get("url").and_then(|u| u.as_str()) {
                            if url_str.starts_with("data:") && url_str.contains(";base64,") {
                                let parts_split: Vec<&str> = url_str.split(";base64,").collect();
                                if parts_split.len() == 2 {
                                    let prefix = parts_split[0];
                                    let base64_data = parts_split[1];
                                    let media_type = prefix.trim_start_matches("data:");
                                    parts.push(serde_json::json!({
                                        "inline_data": {
                                            "mime_type": media_type,
                                            "data": base64_data
                                        }
                                    }));
                                }
                            }
                        }
                    }
                } else if part_type == "document_data" {
                    // PDF 文档多模态支持：将 base64 PDF 数据转换为 Gemini inline_data 格式
                    if let Some(doc_data_obj) = item.get("document_data") {
                        if let Some(url_str) = doc_data_obj.get("url").and_then(|u| u.as_str()) {
                            if url_str.starts_with("data:") && url_str.contains(";base64,") {
                                let parts_split: Vec<&str> = url_str.split(";base64,").collect();
                                if parts_split.len() == 2 {
                                    let prefix = parts_split[0];
                                    let base64_data = parts_split[1];
                                    let media_type = prefix.trim_start_matches("data:");
                                    parts.push(serde_json::json!({
                                        "inline_data": {
                                            "mime_type": media_type,
                                            "data": base64_data
                                        }
                                    }));
                                }
                            }
                        }
                    }
                } else if part_type == "audio_data" {
                    // 音频多模态支持：将 base64 音频数据转换为 Gemini inline_data 格式
                    if let Some(audio_data_obj) = item.get("audio_data") {
                        if let Some(url_str) = audio_data_obj.get("url").and_then(|u| u.as_str()) {
                            if url_str.starts_with("data:") && url_str.contains(";base64,") {
                                let parts_split: Vec<&str> = url_str.split(";base64,").collect();
                                if parts_split.len() == 2 {
                                    let prefix = parts_split[0];
                                    let base64_data = parts_split[1];
                                    let media_type = prefix.trim_start_matches("data:");
                                    parts.push(serde_json::json!({
                                        "inline_data": {
                                            "mime_type": media_type,
                                            "data": base64_data
                                        }
                                    }));
                                }
                            }
                        }
                    }
                }
            }
        }

        if !parts.is_empty() {
            contents.push(serde_json::json!({
                "role": role,
                "parts": parts
            }));
        }
    }

    // 双通道强化保障：如果存在 system 提示词，我们将其前置以最强优先级注入到 contents 数组第一条 user 消息最前端
    if let Some(ref sys_p) = combined_system_prompt {
        let mut injected = false;
        for item in &mut contents {
            if item.get("role").and_then(|r| r.as_str()) == Some("user") {
                if let Some(parts_arr) = item.get_mut("parts").and_then(|p| p.as_array_mut()) {
                    parts_arr.insert(0, serde_json::json!({
                        "text": format!("【系统核心环境指令（请务必最高优先级严格遵守）：\n{}\n】\n\n", sys_p)
                    }));
                    injected = true;
                    break;
                }
            }
        }

        if !injected {
            contents.insert(0, serde_json::json!({
                "role": "user",
                "parts": [
                    {
                        "text": format!("【系统核心环境指令（请务必最高优先级严格遵守）：\n{}\n】\n\n你好，请严格按照上述设定的环境指令提供专业服务。", sys_p)
                    }
                ]
            }));
        }
    }

    (serde_json::Value::Array(contents), system_instruction)
}

#[tauri::command]
pub async fn chat_completion(
    request: ChatCompletionRequestDto,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    // 判定模型是否需要使用 12API 官方指定的 Claude Messages API 端点与格式
    let is_claude_messages_api = request.model == "claude-sonnet-4-6";
    let is_gemini_api = request.model == "gemini-3.1-pro-preview";

    let endpoint = if is_gemini_api {
        let mut base_url_cleaned = request.base_url.trim_end_matches('/').to_string();
        if base_url_cleaned.ends_with("/v1") {
            base_url_cleaned = base_url_cleaned[..base_url_cleaned.len() - 3].to_string();
        }
        format!("{}/v1beta/models/{}:generateContent?key={}", base_url_cleaned, request.model, request.api_key)
    } else if is_claude_messages_api {
        if request.base_url.ends_with("/v1") || request.base_url.ends_with("/v1/") {
            format!("{}/messages", request.base_url.trim_end_matches('/'))
        } else {
            format!("{}/v1/messages", request.base_url.trim_end_matches('/'))
        }
    } else {
        if request.base_url.ends_with("/v1") || request.base_url.ends_with("/v1/") {
            format!("{}/chat/completions", request.base_url.trim_end_matches('/'))
        } else {
            format!("{}/v1/chat/completions", request.base_url.trim_end_matches('/'))
        }
    };

    let mut body = if is_gemini_api {
        let (contents, system_instruction) = translate_openai_to_gemini(&request.messages);
        let mut gemini_body = serde_json::json!({
            "contents": contents,
        });
        if let Some(sys_inst) = system_instruction {
            if let Some(obj) = gemini_body.as_object_mut() {
                obj.insert("system_instruction".to_string(), sys_inst);
            }
        }
        gemini_body
    } else {
        serde_json::json!({
            "model": request.model,
            "messages": request.messages,
        })
    };

    if is_claude_messages_api {
        // 多模态与系统角色自愈：提取 messages 中的 system 角色前置至顶级 system 参数，并过滤消息列表以完全合规 Anthropic API
        if let Some(msgs) = body.get_mut("messages") {
            if let Some(sys_prompt) = translate_openai_to_claude(msgs) {
                if let Some(obj) = body.as_object_mut() {
                    obj.insert("system".to_string(), serde_json::json!(sys_prompt));
                }
            }
        }

        // Claude Messages 必须指定 max_tokens 字段以保证对话生成顺畅
        if let Some(obj) = body.as_object_mut() {
            obj.insert("max_tokens".to_string(), serde_json::json!(4096));
        }
    }

    tracing::info!("Sending chat completion to {}, model: {}", endpoint, request.model);

    let mut req_builder = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .json(&body);

    if !is_gemini_api {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", request.api_key));
    }

    if is_claude_messages_api {
        // 按照 12API 及原生 Anthropic 官方文档要求，发送 Claude 消息协议带上 anthropic-version，并双重携带 x-api-key 头以兼容不同网关的鉴权机制
        req_builder = req_builder
            .header("anthropic-version", "2023-06-01")
            .header("x-api-key", request.api_key.as_str());
    }

    let res = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        return Err(format!("API Error ({}): {}", status, text));
    }

    if is_gemini_api {
        // 关键包装：把 Gemini 格式的 Response 优雅重组并包装为标准的 OpenAI choices 响应，完美兼容前端所有解析架构！
        if let Ok(gemini_json) = serde_json::from_str::<serde_json::Value>(&text) {
            let content_text = gemini_json
                .get("candidates")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|first| first.get("content"))
                .and_then(|content| content.get("parts"))
                .and_then(|parts| parts.as_array())
                .and_then(|arr| arr.first())
                .and_then(|part| part.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");

            let openai_compatible = serde_json::json!({
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": content_text
                        }
                    }
                ]
            });
            return Ok(openai_compatible.to_string());
        }
    } else if is_claude_messages_api {
        // 关键包装：把 Claude 格式的 Response 优雅重组并包装为标准的 OpenAI choices 响应，完美兼容前端所有解析架构！
        if let Ok(claude_json) = serde_json::from_str::<serde_json::Value>(&text) {
            let content_text = claude_json
                .get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");

            let openai_compatible = serde_json::json!({
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": content_text
                        }
                    }
                ]
            });
            return Ok(openai_compatible.to_string());
        }
    }

    Ok(text)
}

