use std::io::Cursor;
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use flate2::read::GzDecoder;
use futures_util::{SinkExt, StreamExt};
use reqwest::{multipart, StatusCode};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;

use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct SpeechApiSettings {
    pub deepgram_api_key: String,
    pub openai_api_key: String,
    pub google_api_key: String,
    pub google_project_id: String,
    pub google_region: String,
    pub nvidia_base_url: String,
    pub nvidia_api_key: String,
    pub alibaba_api_key: String,
    pub alibaba_base_url: String,
    pub doubao_access_token: String,
    pub doubao_app_id: String,
    pub doubao_cluster: String,
}

pub async fn transcribe(
    client: &reqwest::Client,
    audio: &[f32],
    language: &str,
    model: &str,
    settings: SpeechApiSettings,
) -> AppResult<String> {
    if audio.is_empty() {
        return Ok(String::new());
    }

    let wav_bytes = pcm_to_wav(audio)?;

    match model {
        "nova-3" => {
            transcribe_deepgram(client, &wav_bytes, language, &settings.deepgram_api_key).await
        }
        "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" => {
            transcribe_openai(client, &wav_bytes, language, model, &settings.openai_api_key).await
        }
        "chirp_3" => transcribe_google_chirp(client, &wav_bytes, language, &settings).await,
        "nvidia-parakeet-tdt-0.6b-v2" | "nvidia-canary-qwen-2.5b" => {
            transcribe_nvidia(client, &wav_bytes, language, model, &settings).await
        }
        "qwen3-asr-flash" => transcribe_alibaba(client, &wav_bytes, language, &settings).await,
        "doubao-byteplus" => transcribe_doubao(&wav_bytes, language, &settings).await,
        _ => Err(AppError::Config(format!(
            "Unsupported speech model: {}",
            model
        ))),
    }
}

pub async fn validate_openai_api_key(client: &reqwest::Client, api_key: &str) -> AppResult<()> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config("OpenAI API key not configured.".into()));
    }

    let response = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| AppError::Transcription(format!("OpenAI validation request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "OpenAI API returned {}: {}",
            status, body
        )));
    }

    Ok(())
}

pub async fn validate_deepgram_api_key(client: &reqwest::Client, api_key: &str) -> AppResult<()> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config("Deepgram API key not configured.".into()));
    }

    let wav_bytes = pcm_to_wav(&vec![0.0; 1600])?;
    let url = "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=en-US";

    let response = client
        .post(url)
        .header("Content-Type", "audio/wav")
        .header("Authorization", format!("Token {}", api_key.trim()))
        .body(wav_bytes)
        .send()
        .await
        .map_err(|error| {
            AppError::Transcription(format!("Deepgram validation request failed: {}", error))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "Deepgram validation returned {}: {}",
            status, body
        )));
    }

    Ok(())
}

pub async fn validate_google_speech_config(
    client: &reqwest::Client,
    api_key: &str,
    project_id: &str,
    region: &str,
) -> AppResult<()> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config("Google Speech API key not configured.".into()));
    }
    if project_id.trim().is_empty() {
        return Err(AppError::Config(
            "Google Speech project ID not configured.".into(),
        ));
    }

    let settings = SpeechApiSettings {
        deepgram_api_key: String::new(),
        openai_api_key: String::new(),
        google_api_key: api_key.trim().to_string(),
        google_project_id: project_id.trim().to_string(),
        google_region: if region.trim().is_empty() {
            "us".to_string()
        } else {
            region.trim().to_string()
        },
        nvidia_base_url: String::new(),
        nvidia_api_key: String::new(),
        alibaba_api_key: String::new(),
        alibaba_base_url: String::new(),
        doubao_access_token: String::new(),
        doubao_app_id: String::new(),
        doubao_cluster: String::new(),
    };

    let wav_bytes = pcm_to_wav(&vec![0.0; 1600])?;
    transcribe_google_chirp(client, &wav_bytes, "en", &settings).await?;

    Ok(())
}

pub async fn validate_nvidia_config(client: &reqwest::Client, base_url: &str, api_key: &str) -> AppResult<()> {
    if base_url.trim().is_empty() {
        return Err(AppError::Config(
            "NVIDIA base URL not configured.".into(),
        ));
    }

    let endpoint = join_endpoint(base_url, "/v1/audio/transcriptions");
    let request = client.post(endpoint);
    let request = if api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(api_key.trim())
    };

    let response = request.send().await.map_err(|error| {
        AppError::Transcription(format!("NVIDIA validation request failed: {}", error))
    })?;

    let status = response.status();
    if status.is_success()
        || status == StatusCode::BAD_REQUEST
        || status == StatusCode::UNSUPPORTED_MEDIA_TYPE
        || status == StatusCode::UNPROCESSABLE_ENTITY
    {
        return Ok(());
    }

    let body = response.text().await.unwrap_or_default();
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(AppError::Transcription(
            format!("NVIDIA endpoint rejected the API key: {}", body),
        )),
        StatusCode::NOT_FOUND => Err(AppError::Transcription(
            "NVIDIA endpoint did not expose /v1/audio/transcriptions.".into(),
        )),
        _ => Err(AppError::Transcription(format!(
            "NVIDIA validation returned {}: {}",
            status, body
        ))),
    }
}

fn pcm_to_wav(audio: &[f32]) -> AppResult<Vec<u8>> {
    let mut cursor = Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|e| AppError::Transcription(format!("Failed to create WAV: {}", e)))?;

        for &sample in audio {
            let clamped = sample.clamp(-1.0, 1.0);
            let int_sample = (clamped * i16::MAX as f32) as i16;
            writer.write_sample(int_sample).map_err(|e| {
                AppError::Transcription(format!("Failed to write WAV sample: {}", e))
            })?;
        }

        writer
            .finalize()
            .map_err(|e| AppError::Transcription(format!("Failed to finalize WAV: {}", e)))?;
    }

    Ok(cursor.into_inner())
}

async fn transcribe_openai(
    client: &reqwest::Client,
    wav_bytes: &[u8],
    language: &str,
    model: &str,
    api_key: &str,
) -> AppResult<String> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config(
            "Speech model requires OpenAI API key. Set speech_openai_api_key in settings.".into(),
        ));
    }

    #[derive(Deserialize)]
    struct OpenAiTranscriptionResponse {
        text: String,
    }

    let file_part = multipart::Part::bytes(wav_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| AppError::Transcription(format!("Failed to prepare audio part: {}", e)))?;

    let form = multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string())
        .text("language", language.to_string());

    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            AppError::Transcription(format!("OpenAI transcription request failed: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "OpenAI transcription API returned {}: {}",
            status, body
        )));
    }

    let parsed: OpenAiTranscriptionResponse = response
        .json()
        .await
        .map_err(|e| AppError::Transcription(format!("Failed to parse OpenAI response: {}", e)))?;

    Ok(parsed.text.trim().to_string())
}

#[derive(Deserialize)]
struct DeepgramResponse {
    results: DeepgramResults,
}

#[derive(Deserialize)]
struct DeepgramResults {
    channels: Vec<DeepgramChannel>,
}

#[derive(Deserialize)]
struct DeepgramChannel {
    alternatives: Vec<DeepgramAlternative>,
}

#[derive(Deserialize)]
struct DeepgramAlternative {
    transcript: String,
}

async fn transcribe_deepgram(client: &reqwest::Client, wav_bytes: &[u8], language: &str, api_key: &str) -> AppResult<String> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config(
            "Deepgram Nova-3 requires speech_deepgram_api_key in settings.".into(),
        ));
    }

    let url = format!(
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language={}",
        language_to_bcp47(language)
    );

    let response = client
        .post(url)
        .header("Content-Type", "audio/wav")
        .header("Authorization", format!("Token {}", api_key.trim()))
        .body(wav_bytes.to_vec())
        .send()
        .await
        .map_err(|e| AppError::Transcription(format!("Deepgram request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "Deepgram API returned {}: {}",
            status, body
        )));
    }

    let parsed: DeepgramResponse = response.json().await.map_err(|e| {
        AppError::Transcription(format!("Failed to parse Deepgram response: {}", e))
    })?;

    let transcript = parsed
        .results
        .channels
        .into_iter()
        .flat_map(|channel| channel.alternatives.into_iter().map(|alt| alt.transcript))
        .find(|text| !text.trim().is_empty())
        .ok_or_else(|| AppError::Transcription("Deepgram returned empty transcription.".into()))?;

    Ok(transcript.trim().to_string())
}

#[derive(Serialize)]
struct GoogleRecognizeRequest {
    config: GoogleRecognizeConfig,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleRecognizeConfig {
    auto_decoding_config: serde_json::Value,
    language_codes: Vec<String>,
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleRecognizeResponse {
    results: Option<Vec<GoogleResult>>,
}

#[derive(Deserialize)]
struct GoogleResult {
    alternatives: Vec<GoogleAlternative>,
}

#[derive(Deserialize)]
struct GoogleAlternative {
    transcript: String,
}

async fn transcribe_google_chirp(
    client: &reqwest::Client,
    wav_bytes: &[u8],
    language: &str,
    settings: &SpeechApiSettings,
) -> AppResult<String> {
    if settings.google_api_key.trim().is_empty() {
        return Err(AppError::Config(
            "Google Chirp 3 requires speech_google_api_key in settings.".into(),
        ));
    }
    if settings.google_project_id.trim().is_empty() {
        return Err(AppError::Config(
            "Google Chirp 3 requires speech_google_project_id in settings.".into(),
        ));
    }

    let region = if settings.google_region.trim().is_empty() {
        "us"
    } else {
        settings.google_region.trim()
    };

    let content = base64::engine::general_purpose::STANDARD.encode(wav_bytes);
    let request = GoogleRecognizeRequest {
        config: GoogleRecognizeConfig {
            auto_decoding_config: serde_json::json!({}),
            language_codes: vec![language_to_bcp47(language).to_string()],
            model: "chirp_3".to_string(),
        },
        content,
    };

    let url = format!(
        "https://speech.googleapis.com/v2/projects/{}/locations/{}/recognizers/_:recognize?key={}",
        settings.google_project_id, region, settings.google_api_key
    );

    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Transcription(format!("Google Chirp request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "Google Chirp API returned {}: {}",
            status, body
        )));
    }

    let parsed: GoogleRecognizeResponse = response
        .json()
        .await
        .map_err(|e| AppError::Transcription(format!("Failed to parse Google response: {}", e)))?;

    let text = parsed
        .results
        .unwrap_or_default()
        .into_iter()
        .flat_map(|r| r.alternatives.into_iter().map(|a| a.transcript))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    Ok(text)
}

async fn transcribe_nvidia(
    client: &reqwest::Client,
    wav_bytes: &[u8],
    language: &str,
    model: &str,
    settings: &SpeechApiSettings,
) -> AppResult<String> {
    if settings.nvidia_base_url.trim().is_empty() {
        return Err(AppError::Config(
            "NVIDIA speech requires speech_nvidia_base_url in settings.".into(),
        ));
    }

    #[derive(Deserialize)]
    struct NvidiaTranscriptionResponse {
        text: String,
    }

    let file_part = multipart::Part::bytes(wav_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| AppError::Transcription(format!("Failed to prepare audio part: {}", e)))?;

    let form = multipart::Form::new()
        .part("file", file_part)
        .text("language", language_to_bcp47(language).to_string())
        .text("model", model.to_string());

    let endpoint = join_endpoint(&settings.nvidia_base_url, "/v1/audio/transcriptions");
    let request = client.post(endpoint).multipart(form);
    let request = if settings.nvidia_api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(settings.nvidia_api_key.trim())
    };

    let response = request.send().await.map_err(|e| {
        AppError::Transcription(format!("NVIDIA transcription request failed: {}", e))
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "NVIDIA transcription API returned {}: {}",
            status, body
        )));
    }

    let parsed: NvidiaTranscriptionResponse = response
        .json()
        .await
        .map_err(|e| AppError::Transcription(format!("Failed to parse NVIDIA response: {}", e)))?;

    Ok(parsed.text.trim().to_string())
}

async fn transcribe_alibaba(
    client: &reqwest::Client,
    wav_bytes: &[u8],
    language: &str,
    settings: &SpeechApiSettings,
) -> AppResult<String> {
    if settings.alibaba_api_key.trim().is_empty() {
        return Err(AppError::Config(
            "Alibaba speech requires alibaba_api_key in settings.".into(),
        ));
    }

    let endpoint = join_endpoint(&settings.alibaba_base_url, "/chat/completions");
    let data = base64::engine::general_purpose::STANDARD.encode(wav_bytes);
    let request = serde_json::json!({
        "model": "qwen3-asr-flash",
        "stream": false,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": format!("data:audio/wav;base64,{}", data),
                            "format": "wav"
                        }
                    },
                    {
                        "type": "text",
                        "text": "Transcribe this audio and return only the transcript."
                    }
                ]
            }
        ],
        "asr_options": {
            "language": language
        }
    });

    let response = client
        .post(endpoint)
        .bearer_auth(settings.alibaba_api_key.trim())
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            AppError::Transcription(format!("Alibaba transcription request failed: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Transcription(format!(
            "Alibaba transcription API returned {}: {}",
            status, body
        )));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| AppError::Transcription(format!("Failed to parse Alibaba response: {}", e)))?;

    extract_compatible_text(&parsed)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| AppError::Transcription("Alibaba returned empty transcription.".into()))
}

async fn transcribe_doubao(
    wav_bytes: &[u8],
    language: &str,
    settings: &SpeechApiSettings,
) -> AppResult<String> {
    if settings.doubao_access_token.trim().is_empty() {
        return Err(AppError::Config(
            "Doubao/byteplus requires speech_doubao_access_token in settings.".into(),
        ));
    }
    if settings.doubao_app_id.trim().is_empty() {
        return Err(AppError::Config(
            "Doubao/byteplus requires speech_doubao_app_id in settings.".into(),
        ));
    }

    #[derive(Serialize)]
    struct DoubaoApp {
        appid: String,
        token: String,
        cluster: String,
    }

    #[derive(Serialize)]
    struct DoubaoUser {
        uid: String,
    }

    #[derive(Serialize)]
    struct DoubaoAudio {
        format: String,
        codec: String,
        sample_rate: i32,
        bits: i32,
        channel: i32,
        data: String,
    }

    #[derive(Serialize)]
    struct DoubaoRequest {
        app: DoubaoApp,
        user: DoubaoUser,
        audio: DoubaoAudio,
        request: serde_json::Value,
    }

    #[derive(Deserialize)]
    struct DoubaoResponse {
        text: Option<String>,
        result: Option<String>,
        message: Option<String>,
        code: Option<i64>,
    }

    let cluster = if settings.doubao_cluster.trim().is_empty() {
        "byteplus_input".to_string()
    } else {
        settings.doubao_cluster.trim().to_string()
    };

    let req_id = format!(
        "dictateai-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    let request = DoubaoRequest {
        app: DoubaoApp {
            appid: settings.doubao_app_id.clone(),
            token: settings.doubao_access_token.clone(),
            cluster,
        },
        user: DoubaoUser {
            uid: "dictateai".to_string(),
        },
        audio: DoubaoAudio {
            format: "wav".to_string(),
            codec: "raw".to_string(),
            sample_rate: 16000,
            bits: 16,
            channel: 1,
            data: base64::engine::general_purpose::STANDARD.encode(wav_bytes),
        },
        request: serde_json::json!({
            "reqid": req_id,
            "model_name": "bigmodel",
            "language": language,
            "show_utterances": false,
        }),
    };

    let mut ws_request = "wss://openspeech.byteoversea.com/api/v2/asr"
        .into_client_request()
        .map_err(|e| {
            AppError::Transcription(format!("Failed to build Doubao WS request: {}", e))
        })?;
    ws_request.headers_mut().insert(
        "Authorization",
        format!("Bearer; {}", settings.doubao_access_token)
            .parse()
            .map_err(|e| AppError::Transcription(format!("Invalid Doubao auth header: {}", e)))?,
    );
    ws_request.headers_mut().insert(
        "User-Agent",
        "dictateai"
            .parse()
            .map_err(|e| AppError::Transcription(format!("Invalid user-agent header: {}", e)))?,
    );

    let (mut ws, _resp) = connect_async(ws_request).await.map_err(|e| {
        AppError::Transcription(format!("Failed to connect Doubao websocket: {}", e))
    })?;

    let payload = serde_json::to_vec(&request)
        .map_err(|e| AppError::Transcription(format!("Failed to encode Doubao request: {}", e)))?;
    let payload = gzip_compress(&payload)?;
    let packet = build_doubao_packet(&payload);

    ws.send(Message::Binary(packet)).await.map_err(|e| {
        AppError::Transcription(format!("Failed to send Doubao websocket request: {}", e))
    })?;

    let mut final_text = String::new();
    while let Some(msg) = ws.next().await {
        let msg = msg.map_err(|e| {
            AppError::Transcription(format!("Doubao websocket receive failed: {}", e))
        })?;

        match msg {
            Message::Binary(bytes) => {
                let text = parse_doubao_packet(&bytes)?;
                if text.trim().is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<DoubaoResponse>(&text) {
                    if let Some(code) = parsed.code {
                        if code != 0 {
                            return Err(AppError::Transcription(format!(
                                "Doubao returned error code {}: {}",
                                code,
                                parsed
                                    .message
                                    .unwrap_or_else(|| "unknown error".to_string())
                            )));
                        }
                    }

                    if let Some(t) = parsed.text.or(parsed.result) {
                        if !t.trim().is_empty() {
                            final_text = t.trim().to_string();
                        }
                    }
                } else if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    // Best-effort extraction across BytePlus schema variants.
                    if let Some(t) = value
                        .pointer("/result/text")
                        .and_then(|v| v.as_str())
                        .or_else(|| value.pointer("/text").and_then(|v| v.as_str()))
                        .or_else(|| value.pointer("/payload/text").and_then(|v| v.as_str()))
                    {
                        if !t.trim().is_empty() {
                            final_text = t.trim().to_string();
                        }
                    }
                }
            }
            Message::Text(text) => {
                if !text.trim().is_empty() {
                    final_text = text.trim().to_string();
                }
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => {}
            Message::Frame(_) => {}
        }
    }

    if final_text.is_empty() {
        return Err(AppError::Transcription(
            "Doubao returned empty transcription.".into(),
        ));
    }

    Ok(final_text)
}

fn join_endpoint(base_url: &str, suffix: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let suffix = suffix.trim_start_matches('/');
    if trimmed.ends_with(suffix) {
        trimmed.to_string()
    } else {
        format!("{}/{}", trimmed, suffix)
    }
}

fn extract_compatible_text(value: &serde_json::Value) -> Option<String> {
    let content = value.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    content.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        part.pointer("/text/value")
                            .and_then(serde_json::Value::as_str)
                    })
            })
            .collect::<Vec<_>>()
            .join("")
    })
}

fn language_to_bcp47(code: &str) -> &str {
    match code {
        "en" => "en-US",
        "es" => "es-ES",
        "fr" => "fr-FR",
        "de" => "de-DE",
        "ja" => "ja-JP",
        "zh" => "zh-CN",
        "sv" => "sv-SE",
        "fi" => "fi-FI",
        _ => "en-US",
    }
}

fn gzip_compress(input: &[u8]) -> AppResult<Vec<u8>> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(input)
        .map_err(|e| AppError::Transcription(format!("Failed to gzip Doubao payload: {}", e)))?;
    encoder
        .finish()
        .map_err(|e| AppError::Transcription(format!("Failed to finalize gzip payload: {}", e)))
}

fn build_doubao_packet(payload: &[u8]) -> Vec<u8> {
    // BytePlus binary protocol packet
    // 0x11: protocol v1 + 1 header word (4 bytes)
    // 0x10: full client request
    // 0x11: JSON serialization + gzip compression
    // 0x00: reserved
    let mut packet = Vec::with_capacity(8 + payload.len());
    packet.extend_from_slice(&[0x11, 0x10, 0x11, 0x00]);
    packet.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    packet.extend_from_slice(payload);
    packet
}

fn parse_doubao_packet(frame: &[u8]) -> AppResult<String> {
    if frame.len() < 8 {
        return Ok(String::new());
    }

    let header_size_words = (frame[0] & 0x0f) as usize;
    let header_len = header_size_words * 4;
    if header_len == 0 || frame.len() < header_len + 4 {
        return Ok(String::new());
    }

    let message_type = (frame[1] & 0xf0) >> 4;
    let compression = frame[2] & 0x0f;
    let mut cursor = header_len;

    // Server packets can include a 4-byte sequence number before payload length.
    // See BytePlus message types: full server response / ack / error.
    if matches!(message_type, 0x09 | 0x0b | 0x0f) {
        if frame.len() < cursor + 4 {
            return Ok(String::new());
        }
        cursor += 4;
    }

    if frame.len() < cursor + 4 {
        return Ok(String::new());
    }
    let payload_len = u32::from_be_bytes([
        frame[cursor],
        frame[cursor + 1],
        frame[cursor + 2],
        frame[cursor + 3],
    ]) as usize;
    cursor += 4;

    let payload_start = cursor;
    let payload_end = payload_start.saturating_add(payload_len).min(frame.len());
    if payload_start >= payload_end || payload_start >= frame.len() {
        return Ok(String::new());
    }

    let mut payload = frame[payload_start..payload_end].to_vec();
    if compression == 1 {
        let mut decoder = GzDecoder::new(payload.as_slice());
        let mut decompressed = Vec::new();
        match decoder.read_to_end(&mut decompressed) {
            Ok(_) => payload = decompressed,
            Err(_) => {
                // Some frames are marked as compressed while payload is actually plain bytes.
                // Keep original payload and continue best-effort parsing.
            }
        }
    }

    Ok(String::from_utf8_lossy(&payload).to_string())
}
