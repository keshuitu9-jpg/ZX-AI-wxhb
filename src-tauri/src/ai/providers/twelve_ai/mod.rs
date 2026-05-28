use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::RwLock;
use std::io::Cursor;
use image::ImageFormat;
use tracing::{info, warn};

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderRuntimeConfig, ProviderTaskHandle, ProviderTaskPollResult,
    ProviderTaskSubmission,
};

const GEMINI_TEXT_PROVIDER_ID: &str = "12ai-text";
const GEMINI_IMAGE_PROVIDER_ID: &str = "12ai-gemini-image";
const GPT_IMAGE_PROVIDER_ID: &str = "12ai-gpt-image";
const VEO_VIDEO_PROVIDER_ID: &str = "12ai-veo";

const GEMINI_TEXT_MODEL: &str = "gemini-3.1-pro-preview";
const GEMINI_IMAGE_MODEL: &str = "gemini-3-pro-image-preview";
const GPT_IMAGE_MODEL: &str = "gpt-image-2";
const VEO_VIDEO_MODEL: &str = "veo_3_1-fast";

const GEMINI_TEXT_BASE_URL: &str = "https://cdn.12ai.org";
const GEMINI_IMAGE_BASE_URL: &str = "https://cdn.12ai.org";
const GPT_IMAGE_BASE_URL: &str = "https://cdn.12ai.org";
const ASYNC_IMAGE_BASE_URL: &str = "https://cdn.12ai.org";
const VEO_VIDEO_BASE_URL: &str = "https://api.12ai.org";
const VEO_VIDEO_API_KEY: &str = "sk-OuHwkhJZU059NV4lU3iyiAXXgLv9zA1tocLS6RI5YHZY33Dc";

#[derive(Debug, Clone, Copy)]
enum TwelveAiProviderKind {
    Text,
    GeminiImage,
    GptImage,
    VeoVideo,
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateContentResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    #[serde(alias = "inlineData", alias = "inline_data")]
    inline_data: Option<GeminiInlineData>,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiInlineData {
    #[serde(alias = "mimeType", alias = "mime_type")]
    mime_type: Option<String>,
    data: Option<String>,
}

#[derive(Debug, Serialize)]
struct TwelveAiGenerationRequestBody {
    model: String,
    prompt: String,
    size: String,
    quality: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    n: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TwelveAiAsyncSubmissionResponse {
    id: String,
    #[allow(dead_code)]
    status: String,
}

#[derive(Debug, Deserialize)]
struct TwelveAiAsyncStatusResponse {
    #[allow(dead_code)]
    id: String,
    status: String,
    data: Option<Vec<TwelveAiAsyncStatusDataItem>>,
    video: Option<Value>,
    error: Option<TwelveAiAsyncError>,
}

#[derive(Debug, Deserialize)]
struct TwelveAiAsyncStatusDataItem {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TwelveAiAsyncError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct TwelveAiSyncResponse {
    data: Vec<TwelveAiSyncDataItem>,
}

#[derive(Debug, Deserialize)]
struct TwelveAiSyncDataItem {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    b64_json: Option<String>,
}

pub struct TwelveAiProvider {
    client: Client,
    fallback_client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url_override: Arc<RwLock<Option<String>>>,
    model_override: Arc<RwLock<Option<String>>>,
    provider_id: &'static str,
    default_base_url: &'static str,
    supported_model: Option<&'static str>,
    kind: TwelveAiProviderKind,
    prefer_async: Arc<AtomicBool>,
}

impl TwelveAiProvider {
    fn build_client(disable_proxy: bool) -> Client {
        let mut builder = Client::builder()
            .connect_timeout(Duration::from_secs(60))
            .timeout(Duration::from_secs(300))
            .danger_accept_invalid_certs(true)
            .user_agent("Mozilla/5.0 Storyboard-Copilot/12AI")
            .tcp_nodelay(true);

        if disable_proxy {
            builder = builder.no_proxy();
        }

        builder.build().unwrap_or_else(|error| {
            warn!(
                "[12AI Request] failed to build reqwest client (disable_proxy={}): {}",
                disable_proxy, error
            );
            Client::new()
        })
    }

    pub fn new_text() -> Self {
        Self::new(
            GEMINI_TEXT_PROVIDER_ID,
            GEMINI_TEXT_BASE_URL,
            Some(GEMINI_TEXT_MODEL),
            TwelveAiProviderKind::Text,
        )
    }

    pub fn new_gemini_image() -> Self {
        Self::new(
            GEMINI_IMAGE_PROVIDER_ID,
            GEMINI_IMAGE_BASE_URL,
            Some(GEMINI_IMAGE_MODEL),
            TwelveAiProviderKind::GeminiImage,
        )
    }

    pub fn new_gpt_image() -> Self {
        Self::new(
            GPT_IMAGE_PROVIDER_ID,
            GPT_IMAGE_BASE_URL,
            Some(GPT_IMAGE_MODEL),
            TwelveAiProviderKind::GptImage,
        )
    }

    pub fn new_veo_video() -> Self {
        Self {
            client: Self::build_client(false),
            fallback_client: Self::build_client(true),
            api_key: Arc::new(RwLock::new(Some(VEO_VIDEO_API_KEY.to_string()))),
            base_url_override: Arc::new(RwLock::new(None)),
            model_override: Arc::new(RwLock::new(None)),
            provider_id: VEO_VIDEO_PROVIDER_ID,
            default_base_url: VEO_VIDEO_BASE_URL,
            supported_model: Some(VEO_VIDEO_MODEL),
            kind: TwelveAiProviderKind::VeoVideo,
            prefer_async: Arc::new(AtomicBool::new(true)),
        }
    }

    fn new(
        provider_id: &'static str,
        base_url: &'static str,
        supported_model: Option<&'static str>,
        kind: TwelveAiProviderKind,
    ) -> Self {
        Self {
            client: Self::build_client(false),
            fallback_client: Self::build_client(true),
            api_key: Arc::new(RwLock::new(None)),
            base_url_override: Arc::new(RwLock::new(None)),
            model_override: Arc::new(RwLock::new(None)),
            provider_id,
            default_base_url: base_url,
            supported_model,
            kind,
            prefer_async: Arc::new(AtomicBool::new(true)),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn normalize_runtime_value(value: Option<String>) -> Option<String> {
        value.and_then(|item| {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
    }

    fn normalize_base_url(value: Option<String>) -> Option<String> {
        Self::normalize_runtime_value(value)
            .map(|item| item.trim_end_matches('/').to_string())
    }

    fn decode_file_url_path(value: &str) -> String {
        let raw = value.trim_start_matches("file://");
        let decoded = urlencoding::decode(raw)
            .map(|result| result.into_owned())
            .unwrap_or_else(|_| raw.to_string());
        let normalized = if decoded.starts_with('/')
            && decoded.len() > 2
            && decoded.as_bytes().get(2) == Some(&b':')
        {
            &decoded[1..]
        } else {
            &decoded
        };
        normalized.to_string()
    }

    fn source_to_bytes(source: &str) -> Result<Vec<u8>, String> {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            return Err("source is empty".to_string());
        }

        if let Some((meta, payload)) = trimmed.split_once(',') {
            if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
                return STANDARD
                    .decode(payload)
                    .map_err(|err| format!("invalid data-url base64 payload: {}", err));
            }
        }

        let likely_base64 = trimmed.len() > 256
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
        if likely_base64 {
            return STANDARD
                .decode(trimmed)
                .map_err(|err| format!("invalid base64 payload: {}", err));
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };

        std::fs::read(&path).map_err(|err| {
            format!(
                "failed to read path \"{}\": {}",
                path.to_string_lossy(),
                err
            )
        })
    }

    fn build_endpoint(base_url: &str, path_after_v1: &str) -> String {
        if base_url.ends_with("/v1") {
            format!("{}/{}", base_url, path_after_v1)
        } else {
            format!("{}/v1/{}", base_url, path_after_v1)
        }
    }

    fn extract_quality(request: &GenerateRequest) -> String {
        let quality = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("quality"))
            .and_then(|value| value.as_str())
            .unwrap_or("high");

        match quality {
            "auto" | "low" | "medium" | "high" => quality.to_string(),
            _ => "high".to_string(),
        }
    }

    fn tier_to_target_pixels(size_tier: &str) -> Option<f64> {
        match size_tier {
            "1K" => Some(1024.0 * 1024.0),
            "2K" => Some(2048.0 * 2048.0),
            "4K" => Some(2880.0 * 2880.0),
            _ => None,
        }
    }

    fn resolve_size(size_tier: &str, aspect_ratio: &str) -> String {
        let trimmed_size = size_tier.trim();
        if trimmed_size.eq_ignore_ascii_case("auto") {
            return "auto".to_string();
        }

        if trimmed_size.contains('x') {
            return trimmed_size.to_string();
        }

        let Some(target_pixels) = Self::tier_to_target_pixels(trimmed_size) else {
            return "1024x1024".to_string();
        };

        let (ratio_width, ratio_height) = aspect_ratio
            .split_once(':')
            .and_then(|(left, right)| {
                let width = left.parse::<f64>().ok()?;
                let height = right.parse::<f64>().ok()?;
                if width > 0.0 && height > 0.0 {
                    Some((width, height))
                } else {
                    None
                }
            })
            .unwrap_or((1.0, 1.0));

        let ratio = ratio_width / ratio_height;
        let width_raw = (target_pixels * ratio).sqrt();
        let height_raw = width_raw / ratio;

        let round_to_multiple_of_16 = |value: f64| -> i32 {
            let rounded = (value / 16.0).round() * 16.0;
            rounded.max(16.0) as i32
        };

        let width = round_to_multiple_of_16(width_raw).clamp(16, 3840);
        let height = round_to_multiple_of_16(height_raw).clamp(16, 3840);
        format!("{}x{}", width, height)
    }

    fn prepare_reference_image(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
        let Ok(img) = image::load_from_memory(&bytes) else {
            return Ok(bytes); // 如果无法解析，原样返回
        };

        let (width, height) = (img.width(), img.height());
        let max_dim = 1024; // 进一步限制参考图最大边长为 1024px，减少 502 风险

        if width > max_dim || height > max_dim || bytes.len() > 1024 * 1024 {
            let resized = img.thumbnail(max_dim, max_dim);
            let mut buf = Vec::new();
            // 使用 JPEG 85% 质量压缩，能显著减小体积
            if let Err(e) = resized.write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg) {
                warn!("[12AI] Failed to compress image: {}", e);
                return Ok(bytes);
            }
            info!("[12AI] Optimized reference image: {}x{} -> {}x{}, size: {} -> {} bytes", 
                width, height, resized.width(), resized.height(), bytes.len(), buf.len());
            Ok(buf)
        } else {
            Ok(bytes)
        }
    }

    fn resolve_gemini_image_size(size_tier: &str) -> Option<&'static str> {
        match size_tier.trim() {
            "1K" => Some("1K"),
            "2K" => Some("2K"),
            "4K" => Some("4K"),
            "auto" => None,
            _ => Some("2K"),
        }
    }

    async fn send_with_fallback<F>(
        &self,
        mode: &'static str,
        build_request: F,
    ) -> Result<reqwest::Response, AIError>
    where
        F: Fn(&Client) -> reqwest::RequestBuilder,
    {
        let mut attempts = 0;
        let max_attempts = 3;
        let mut last_error = None;

        loop {
            attempts += 1;
            let is_last_attempt = attempts >= max_attempts;
            
            // 选择客户端：前几次尝试使用默认客户端，最后一次尝试使用无代理客户端
            let client = if attempts < max_attempts {
                &self.client
            } else {
                &self.fallback_client
            };

            let result = build_request(client).send().await;

            match result {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(resp);
                    }

                    // 只有在遇到 502/503/504 时才重试
                    let is_retryable = status == reqwest::StatusCode::BAD_GATEWAY || 
                                     status == reqwest::StatusCode::SERVICE_UNAVAILABLE || 
                                     status == reqwest::StatusCode::GATEWAY_TIMEOUT;

                    if !is_retryable || is_last_attempt {
                        return Ok(resp);
                    }

                    warn!(
                        "[12AI Request] mode: {}, attempt {}/{} returned {}. Retrying...",
                        mode, attempts, max_attempts, status
                    );
                }
                Err(e) => {
                    if is_last_attempt {
                        return Err(AIError::from(e));
                    }
                    warn!(
                        "[12AI Request] mode: {}, attempt {}/{} failed: {}. Retrying...",
                        mode, attempts, max_attempts, e
                    );
                    last_error = Some(e);
                }
            }

            // 指数退避等待：1s, 2s
            tokio::time::sleep(Duration::from_secs(attempts as u64)).await;
        }
    }

    async fn generate_gemini_image(
        &self,
        api_key: &str,
        base_url: &str,
        request: &GenerateRequest,
        model: &str,
        reference_images: &[String],
    ) -> Result<String, AIError> {
        let endpoint = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            base_url.trim_end_matches('/'),
            model,
            api_key
        );

        let mut parts = vec![json!({ "text": request.prompt })];
        for source in reference_images {
            let bytes = Self::source_to_bytes(source).map_err(|err| {
                AIError::InvalidRequest(format!(
                    "Failed to read reference image for Gemini image request: {}; source={}",
                    err, source
                ))
            })?;
            parts.push(json!({
                "inline_data": {
                    "mime_type": "image/png",
                    "data": STANDARD.encode(bytes),
                }
            }));
        }

        let mut generation_config = json!({
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": request.aspect_ratio,
            }
        });

        if let Some(image_size) = Self::resolve_gemini_image_size(&request.size) {
            generation_config["imageConfig"]["imageSize"] = json!(image_size);
        }

        let body = json!({
            "contents": [
                {
                    "parts": parts
                }
            ],
            "generationConfig": generation_config,
        });

        info!(
            "[12AI Request] provider: {}, mode: gemini-image, model: {}, refs: {}",
            self.provider_id,
            model,
            reference_images.len()
        );

        let response = self
            .send_with_fallback("gemini-image", |client| {
                client
                    .post(&endpoint)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .json(&body)
            })
            .await?;

        Self::parse_gemini_image_response(response).await
    }

    async fn parse_gemini_image_response(response: reqwest::Response) -> Result<String, AIError> {
        let status = response.status();
        
        let bytes = response.bytes().await.map_err(|e| {
            warn!("[12AI Gemini] Failed to read response body: {}", e);
            AIError::Network(e)
        })?;

        if !status.is_success() {
            let error_text = String::from_utf8_lossy(&bytes).to_string();
            return Err(AIError::Provider(format!(
                "12AI Gemini image API error {}: {}",
                status, error_text
            )));
        }

        let payload: GeminiGenerateContentResponse = serde_json::from_slice(&bytes).map_err(|e| {
            let sample = if bytes.len() > 256 {
                String::from_utf8_lossy(&bytes[..256]).to_string()
            } else {
                String::from_utf8_lossy(&bytes).to_string()
            };
            warn!("[12AI Gemini] JSON decode failed: {}. Body sample: {}", e, sample);
            AIError::Json(e)
        })?;

        let candidates = payload.candidates.unwrap_or_default();
        if candidates.is_empty() {
            return Err(AIError::Provider(
                "Gemini image response missing candidates".to_string(),
            ));
        }

        for candidate in &candidates {
            let Some(content) = candidate.content.as_ref() else {
                continue;
            };
            let Some(parts) = content.parts.as_ref() else {
                continue;
            };
            for part in parts {
                if let Some(inline_data) = part.inline_data.as_ref() {
                    if let Some(data) = inline_data.data.as_ref().filter(|value| !value.trim().is_empty()) {
                        let mime_type = inline_data
                            .mime_type
                            .clone()
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "image/png".to_string());
                        return Ok(format!("data:{};base64,{}", mime_type, data));
                    }
                }
            }
        }

        let text_fallback = candidates.into_iter().find_map(|candidate| {
            candidate
                .content
                .into_iter()
                .flat_map(|content| content.parts.unwrap_or_default().into_iter())
                .find_map(|part| part.text)
        });

        Err(AIError::Provider(format!(
            "Gemini image response missing inline image payload{}",
            text_fallback
                .map(|text| format!("; text fallback: {}", text))
                .unwrap_or_default()
        )))
    }

    async fn poll_async_task(
        &self,
        api_key: &str,
        base_url: &str,
        task_id: &str,
        endpoint_type: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let path = if matches!(self.kind, TwelveAiProviderKind::VeoVideo) {
            format!("videos/{}", task_id)
        } else {
            format!("images/async/{}/{}", endpoint_type, task_id)
        };
        let endpoint = Self::build_endpoint(base_url, &path);

        let response = self
            .send_with_fallback("async-poll", |client| {
                client
                    .get(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Accept", "application/json")
            })
            .await?;

        let status = response.status();
        let bytes = response.bytes().await.map_err(AIError::Network)?;

        if !status.is_success() {
            let error_text = String::from_utf8_lossy(&bytes).to_string();
            return Err(AIError::Provider(format!(
                "12AI Async poll error {}: {}",
                status, error_text
            )));
        }

        let result: TwelveAiAsyncStatusResponse =
            serde_json::from_slice(&bytes).map_err(AIError::Json)?;

        match result.status.as_str() {
            "pending" | "processing" | "queued" => Ok(ProviderTaskPollResult::Running),
            "complete" | "succeeded" | "completed" => {
                let url = if let Some(video_val) = &result.video {
                    if let Some(video_str) = video_val.as_str() {
                        Some(video_str.to_string())
                    } else if let Some(video_obj) = video_val.as_object() {
                        video_obj.get("url").and_then(|u| u.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    }
                } else {
                    result
                        .data
                        .and_then(|items| items.into_iter().next())
                        .and_then(|item| item.url)
                };

                let url = url.ok_or_else(|| {
                    AIError::Provider("Async task completed but missing URL".to_string())
                })?;
                Ok(ProviderTaskPollResult::Succeeded(url))
            }
            "failed" => {
                let msg = result
                    .error
                    .map(|e| e.message)
                    .unwrap_or_else(|| "Unknown async error".to_string());
                Ok(ProviderTaskPollResult::Failed(msg))
            }
            _ => {
                warn!("[12AI Async] Unknown status: {}", result.status);
                Ok(ProviderTaskPollResult::Running)
            }
        }
    }

    async fn submit_async_veo_video(
        &self,
        api_key: &str,
        base_url: &str,
        request: &GenerateRequest,
        model: &str,
        reference_images: &[String],
    ) -> Result<TwelveAiAsyncSubmissionResponse, AIError> {
        let endpoint = Self::build_endpoint(base_url, "videos");
        let model_owned = model.to_string();
        let prompt_owned = request.prompt.clone();
        let size_owned = Self::resolve_size(&request.size, &request.aspect_ratio);

        let image_payloads = reference_images
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let raw_bytes = Self::source_to_bytes(source).map_err(|err| {
                    AIError::InvalidRequest(format!(
                        "Failed to read image for Veo video: {}; source={}",
                        err, source
                    ))
                })?;
                let optimized = Self::prepare_reference_image(raw_bytes).map_err(|err| {
                    AIError::InvalidRequest(format!("Failed to optimize Veo reference image: {}", err))
                })?;
                Ok((index, optimized))
            })
            .collect::<Result<Vec<_>, AIError>>()?;

        info!(
            "[Veo Video] Submitting: model={}, size={}, refs={}",
            model_owned, size_owned, reference_images.len()
        );

        let response = self
            .send_with_fallback("veo-video", |client| {
                let mut form = Form::new()
                    .text("model", model_owned.clone())
                    .text("prompt", prompt_owned.clone())
                    .text("size", size_owned.clone());

                for (i, (_, bytes)) in image_payloads.iter().enumerate() {
                    let part = Part::bytes(bytes.clone())
                        .file_name(format!("ref-{}.jpg", i + 1))
                        .mime_str("image/jpeg")
                        .expect("valid hardcoded mime");
                    form = form.part("input_reference[]", part);
                }

                client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Accept", "application/json")
                    .multipart(form)
            })
            .await?;

        let status = response.status();
        let bytes = response.bytes().await.map_err(AIError::Network)?;

        if !status.is_success() {
            let error_text = String::from_utf8_lossy(&bytes).to_string();
            return Err(AIError::Provider(format!(
                "Veo video submission error {}: {}",
                status, error_text
            )));
        }

        serde_json::from_slice(&bytes).map_err(AIError::Json)
    }

    async fn submit_async_generation(
        &self,
        api_key: &str,
        base_url: &str,
        request: &GenerateRequest,
        model: &str,
    ) -> Result<TwelveAiAsyncSubmissionResponse, AIError> {
        let endpoint = Self::build_endpoint(base_url, "images/async/generations");
        let body = TwelveAiGenerationRequestBody {
            model: model.to_string(),
            prompt: request.prompt.clone(),
            size: Self::resolve_size(&request.size, &request.aspect_ratio),
            quality: Self::extract_quality(request),
            n: Some(1),
            response_format: None,
        };

        info!(
            "[12AI Async] Submitting generation: model={}, size={}, quality={}",
            body.model, body.size, body.quality
        );

        let response = self
            .send_with_fallback("async-generate", |client| {
                client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .json(&body)
            })
            .await?;

        let status = response.status();
        let bytes = response.bytes().await.map_err(AIError::Network)?;

        if !status.is_success() {
            let error_text = String::from_utf8_lossy(&bytes).to_string();
            return Err(AIError::Provider(format!(
                "12AI Async submission error {}: {}",
                status, error_text
            )));
        }

        serde_json::from_slice(&bytes).map_err(AIError::Json)
    }

    async fn submit_async_edit(
        &self,
        api_key: &str,
        base_url: &str,
        request: &GenerateRequest,
        model: &str,
        reference_images: &[String],
    ) -> Result<TwelveAiAsyncSubmissionResponse, AIError> {
        let endpoint = Self::build_endpoint(base_url, "images/async/edits");

        let model_owned = model.to_string();
        let prompt_owned = request.prompt.clone();
        let size_owned = Self::resolve_size(&request.size, &request.aspect_ratio);
        let quality_owned = Self::extract_quality(request);

        let image_payloads = reference_images
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let raw_bytes = Self::source_to_bytes(source).map_err(|err| {
                    AIError::InvalidRequest(format!(
                        "Failed to read image for 12AI async edit: {}; source={}",
                        err, source
                    ))
                })?;
                
                let optimized_bytes = Self::prepare_reference_image(raw_bytes).map_err(|err| {
                    AIError::InvalidRequest(format!("Failed to process reference image: {}", err))
                })?;

                Ok((index, optimized_bytes))
            })
            .collect::<Result<Vec<_>, AIError>>()?;

        let total_size: usize = image_payloads.iter().map(|(_, b)| b.len()).sum();
        info!(
            "[12AI Async] Submitting edit: model={}, size={}, quality={}, refs={}, total_payload_size={} bytes",
            model_owned, size_owned, quality_owned, reference_images.len(), total_size
        );

        // 带重试的异步编辑提交（网络不稳定时 unexpected EOF 会自动重试）
        let max_retries = 2;
        let mut last_error = String::new();

        for attempt in 0..=max_retries {
            if attempt > 0 {
                info!("[12AI Async] Retrying edit submission (attempt {}/{})", attempt + 1, max_retries + 1);
                tokio::time::sleep(Duration::from_secs(2)).await;
            }

            let response = self.send_with_fallback("async-edit", |client| {
                let mut request_form = Form::new()
                    .text("model", model_owned.clone())
                    .text("prompt", prompt_owned.clone())
                    .text("size", size_owned.clone())
                    .text("quality", quality_owned.clone())
                    .text("n", "1");

                for (i, (_original_index, bytes)) in image_payloads.iter().enumerate() {
                    let key = "image";
                    let part = Part::bytes(bytes.clone())
                        .file_name(format!("{}-{}.jpg", key, i + 1))
                        .mime_str("image/jpeg")
                        .expect("Valid hardcoded mime type");
                    request_form = request_form.part(key, part);
                }

                client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Accept", "application/json")
                    .multipart(request_form)
            })
            .await;

            let response = match response {
                Ok(r) => r,
                Err(e) => {
                    last_error = e.to_string();
                    if attempt < max_retries {
                        continue;
                    }
                    return Err(e);
                }
            };

            let status = response.status();
            let bytes = response.bytes().await.map_err(AIError::Network)?;

            if !status.is_success() {
                let error_text = String::from_utf8_lossy(&bytes).to_string();
                // 如果是 EOF 或网络相关错误，重试
                if (error_text.contains("unexpected EOF") || error_text.contains("connection")) && attempt < max_retries {
                    last_error = error_text;
                    continue;
                }
                return Err(AIError::Provider(format!(
                    "12AI Async edit submission error {}: {}",
                    status, error_text
                )));
            }

            return serde_json::from_slice(&bytes).map_err(AIError::Json);
        }

        Err(AIError::Provider(format!(
            "12AI Async edit failed after {} retries: {}",
            max_retries, last_error
        )))
    }

    async fn generate_gpt_image_sync(
        &self,
        api_key: &str,
        base_url: &str,
        request: &GenerateRequest,
        model: &str,
        reference_images: &[String],
    ) -> Result<String, AIError> {
        let is_edit = !reference_images.is_empty();
        let path = if is_edit {
            "images/edits"
        } else {
            "images/generations"
        };
        let endpoint = Self::build_endpoint(base_url, path);

        let size = Self::resolve_size(&request.size, &request.aspect_ratio);
        let quality = Self::extract_quality(request);

        info!(
            "[12AI Sync] Submitting {}: model={}, size={}, quality={}, refs={}",
            if is_edit { "edit" } else { "generation" },
            model,
            size,
            quality,
            reference_images.len()
        );

        let response = if is_edit {
            let image_payloads = reference_images
                .iter()
                .enumerate()
                .map(|(index, source)| {
                    let raw_bytes = Self::source_to_bytes(source).map_err(|err| {
                        AIError::InvalidRequest(format!(
                            "Failed to read image for 12AI sync edit: {}; source={}",
                            err, source
                        ))
                    })?;
                    let optimized_bytes = Self::prepare_reference_image(raw_bytes).map_err(|err| {
                        AIError::InvalidRequest(format!("Failed to process reference image: {}", err))
                    })?;
                    Ok((index, optimized_bytes))
                })
                .collect::<Result<Vec<_>, AIError>>()?;

            self.send_with_fallback("sync-edit", |client| {
                let mut request_form = Form::new()
                    .text("model", model.to_string())
                    .text("prompt", request.prompt.clone())
                    .text("size", size.clone())
                    .text("quality", quality.clone())
                    .text("n", "1")
                    .text("response_format", "url");

                for (i, (_original_index, bytes)) in image_payloads.iter().enumerate() {
                    let key = "image";
                    let part = Part::bytes(bytes.clone())
                        .file_name(format!("{}-{}.jpg", key, i + 1))
                        .mime_str("image/jpeg")
                        .expect("Valid hardcoded mime type");
                    request_form = request_form.part(key, part);
                }

                client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Accept", "application/json")
                    .multipart(request_form)
            })
            .await?
        } else {
            let body = TwelveAiGenerationRequestBody {
                model: model.to_string(),
                prompt: request.prompt.clone(),
                size,
                quality,
                n: Some(1),
                response_format: Some("url".to_string()),
            };

            self.send_with_fallback("sync-generate", |client| {
                client
                    .post(&endpoint)
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .json(&body)
            })
            .await?
        };

        let status = response.status();
        let bytes = response.bytes().await.map_err(AIError::Network)?;

        if !status.is_success() {
            let error_text = String::from_utf8_lossy(&bytes).to_string();
            return Err(AIError::Provider(format!(
                "12AI Sync API error {}: {}",
                status, error_text
            )));
        }

        let result: TwelveAiSyncResponse = serde_json::from_slice(&bytes).map_err(AIError::Json)?;
        let item = result
            .data
            .into_iter()
            .next()
            .ok_or_else(|| AIError::Provider("Sync API response missing data".to_string()))?;

        // 优先使用 URL，如果没有则将 base64 保存为本地临时文件
        if let Some(url) = item.url {
            if !url.is_empty() {
                return Ok(url);
            }
        }
        if let Some(b64) = item.b64_json {
            if !b64.is_empty() {
                // 将 base64 解码并保存为临时文件
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(&b64)
                    .map_err(|e| AIError::Provider(format!("Failed to decode base64 image: {}", e)))?;
                let temp_dir = std::env::temp_dir();
                let filename = format!("12ai_sync_{}.png", uuid::Uuid::new_v4());
                let temp_path = temp_dir.join(&filename);
                std::fs::write(&temp_path, &decoded)
                    .map_err(|e| AIError::Provider(format!("Failed to save temp image: {}", e)))?;
                return Ok(temp_path.to_string_lossy().to_string());
            }
        }
        Err(AIError::Provider("Sync API response missing both url and b64_json".to_string()))
    }
}

#[async_trait::async_trait]
impl AIProvider for TwelveAiProvider {
    fn name(&self) -> &str {
        self.provider_id
    }

    fn supports_model(&self, model: &str) -> bool {
        match self.supported_model {
            Some(_) if matches!(self.kind, TwelveAiProviderKind::VeoVideo) => {
                let bare = Self::sanitize_model(model);
                bare == "veo_3_1-fast" || bare == "veo_3_1-fast-fl"
            }
            Some(supported_model) if !matches!(self.kind, TwelveAiProviderKind::Text) => {
                let bare = Self::sanitize_model(model);
                bare == supported_model || bare == "gemini-3.1-flash-image-preview" || bare == "gemini-2.5-flash-image"
            }
            _ => false,
        }
    }

    fn list_models(&self) -> Vec<String> {
        match self.supported_model {
            Some(_) if matches!(self.kind, TwelveAiProviderKind::VeoVideo) => {
                vec![
                    format!("{}/veo_3_1-fast", self.provider_id),
                    format!("{}/veo_3_1-fast-fl", self.provider_id),
                ]
            }
            Some(supported_model) if !matches!(self.kind, TwelveAiProviderKind::Text) => {
                vec![
                    format!("{}/{}", self.provider_id, supported_model),
                    format!("{}/{}", self.provider_id, "gemini-3.1-flash-image-preview"),
                ]
            }
            _ => Vec::new(),
        }
    }

    fn supports_task_resume(&self) -> bool {
        if matches!(self.kind, TwelveAiProviderKind::Text) {
            return false;
        }
        // 同步模式下不支持 task resume，走 generate() 路径
        self.prefer_async.load(Ordering::SeqCst)
    }

    async fn submit_task(&self, request: GenerateRequest) -> Result<ProviderTaskSubmission, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let base_url = self
            .base_url_override
            .read()
            .await
            .clone()
            .unwrap_or_else(|| self.default_base_url.to_string());

        let model = self
            .model_override
            .read()
            .await
            .clone()
            .unwrap_or_else(|| Self::sanitize_model(&request.model));

        let reference_images = request.reference_images.as_deref().unwrap_or(&[]);

        if matches!(self.kind, TwelveAiProviderKind::VeoVideo) {
            let resp = self
                .submit_async_veo_video(&api_key, &base_url, &request, &model, reference_images)
                .await?;
            return Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
                task_id: resp.id,
                metadata: Some(json!({ "endpoint_type": "videos" })),
            }));
        }

        let (resp, endpoint_type) = if reference_images.is_empty() {
            (
                self.submit_async_generation(&api_key, &base_url, &request, &model)
                    .await?,
                "generations",
            )
        } else {
            (
                self.submit_async_edit(&api_key, &base_url, &request, &model, reference_images)
                    .await?,
                "edits",
            )
        };

        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id: resp.id,
            metadata: Some(json!({ "endpoint_type": endpoint_type })),
        }))
    }

    async fn poll_task(&self, handle: ProviderTaskHandle) -> Result<ProviderTaskPollResult, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let base_url = self
            .base_url_override
            .read()
            .await
            .clone()
            .unwrap_or_else(|| self.default_base_url.to_string());

        let endpoint_type = handle
            .metadata
            .as_ref()
            .and_then(|m| m.get("endpoint_type"))
            .and_then(|v| v.as_str())
            .unwrap_or("generations");

        self.poll_async_task(&api_key, &base_url, &handle.task_id, endpoint_type)
            .await
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Self::normalize_runtime_value(Some(api_key));
        Ok(())
    }

    async fn set_runtime_config(&self, config: ProviderRuntimeConfig) -> Result<(), AIError> {
        if let Some(api_key) = config.api_key {
            let mut key = self.api_key.write().await;
            *key = Self::normalize_runtime_value(Some(api_key));
        }
        if let Some(base_url) = config.base_url {
            let mut base_url_override = self.base_url_override.write().await;
            *base_url_override = Self::normalize_base_url(Some(base_url));
        }
        if let Some(model) = config.model {
            let mut model_override = self.model_override.write().await;
            *model_override = Self::normalize_runtime_value(Some(model));
        }
        if let Some(prefer_async) = config.prefer_async {
            self.prefer_async.store(prefer_async, Ordering::SeqCst);
        }
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let base_url = self
            .base_url_override
            .read()
            .await
            .clone()
            .unwrap_or_else(|| self.default_base_url.to_string());
        let model = self
            .model_override
            .read()
            .await
            .clone()
            .unwrap_or_else(|| Self::sanitize_model(&request.model));
        let reference_images = request.reference_images.as_deref().unwrap_or(&[]);

        match self.kind {
            TwelveAiProviderKind::Text => Err(AIError::InvalidRequest(
                "The configured Gemini text route is not connected to image generation nodes"
                    .to_string(),
            )),
            TwelveAiProviderKind::VeoVideo | TwelveAiProviderKind::GeminiImage | TwelveAiProviderKind::GptImage => {
                let is_veo = matches!(self.kind, TwelveAiProviderKind::VeoVideo);
                let prefer_async = self.prefer_async.load(Ordering::SeqCst);
                if !prefer_async && !is_veo {
                    if matches!(self.kind, TwelveAiProviderKind::GeminiImage) {
                        return self
                            .generate_gemini_image(&api_key, &base_url, &request, &model, reference_images)
                            .await;
                    } else {
                        return self
                            .generate_gpt_image_sync(&api_key, &base_url, &request, &model, reference_images)
                            .await;
                    }
                }

                // 统一启用异步轮询模式以确保稳定性
                let submission = self.submit_task(request.clone()).await?;
                match submission {
                    ProviderTaskSubmission::Succeeded(url) => Ok(url),
                    ProviderTaskSubmission::Queued(handle) => {
                        let mut attempts = 0;
                        let max_attempts = if is_veo { 120 } else { 60 };
                        loop {
                            attempts += 1;
                            if attempts > max_attempts {
                                return Err(AIError::Timeout(format!(
                                    "Async {} generation timed out after {} minutes",
                                    if is_veo { "video" } else { "image" },
                                    if is_veo { 10 } else { 5 }
                                )));
                            }

                            tokio::time::sleep(Duration::from_secs(5)).await;

                            match self.poll_task(handle.clone()).await? {
                                ProviderTaskPollResult::Running => continue,
                                ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                                ProviderTaskPollResult::Failed(err) => {
                                    return Err(AIError::Provider(format!(
                                        "Async generation failed: {}",
                                        err
                                    )))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
