use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::rewrite::RewriteOutcome;

const GEMINI_API_URL_PREFIX: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Serialize)]
struct GeminiRequest {
    system_instruction: SystemInstruction,
    contents: Vec<Content>,
    generation_config: GenerationConfig,
}

#[derive(Serialize)]
struct SystemInstruction {
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Serialize)]
struct Part {
    text: String,
}

#[derive(Serialize)]
struct GenerationConfig {
    temperature: f32,
    max_output_tokens: u32,
    #[serde(rename = "thinkingConfig")]
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking_config: Option<ThinkingConfig>,
}

#[derive(Serialize)]
struct ThinkingConfig {
    #[serde(rename = "thinkingLevel")]
    thinking_level: &'static str,
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
    error: Option<GeminiError>,
    /// Per the Gemini docs, present on every successful generateContent
    /// response. Optional here to handle error envelopes that omit it.
    #[serde(rename = "usageMetadata", default)]
    usage_metadata: Option<UsageMetadata>,
}

/// Gemini's token accounting uses different field names from the
/// OpenAI-compatible chat APIs. `promptTokenCount` covers everything we
/// sent (system + user); `candidatesTokenCount` is the model's output.
#[derive(Deserialize, Default)]
struct UsageMetadata {
    #[serde(rename = "promptTokenCount", default)]
    prompt_token_count: u32,
    #[serde(rename = "candidatesTokenCount", default)]
    candidates_token_count: u32,
}

#[derive(Deserialize)]
struct Candidate {
    content: CandidateContent,
}

#[derive(Deserialize)]
struct CandidateContent {
    parts: Vec<ResponsePart>,
}

#[derive(Deserialize)]
struct ResponsePart {
    text: Option<String>,
}

#[derive(Deserialize)]
struct GeminiError {
    message: String,
}

pub async fn rewrite(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> AppResult<RewriteOutcome> {
    if api_key.is_empty() {
        return Err(AppError::Config(
            "Gemini API key not configured. Please set it in Settings.".into(),
        ));
    }

    let (api_model, thinking_config) = match model {
        "gemini-2.5-flash-lite" => ("gemini-2.5-flash-lite", None),
        "gemini-3.1-flash-lite" => (
            "gemini-3.1-flash-lite",
            Some(ThinkingConfig {
                thinking_level: "minimal",
            }),
        ),
        // Legacy: users may still have the pre-rename setting string.
        // Route to the same model under the new name.
        "gemini-3.1-flash-lite-preview" => (
            "gemini-3.1-flash-lite",
            Some(ThinkingConfig {
                thinking_level: "minimal",
            }),
        ),
        _ => ("gemini-2.5-flash-lite", None),
    };

    let request = GeminiRequest {
        system_instruction: SystemInstruction {
            parts: vec![Part {
                text: system_prompt.to_string(),
            }],
        },
        contents: vec![Content {
            parts: vec![Part {
                text: user_message.to_string(),
            }],
        }],
        generation_config: GenerationConfig {
            temperature: 0.3,
            max_output_tokens: 2048,
            thinking_config,
        },
    };

    let url = format!(
        "{}/{}:generateContent?key={}",
        GEMINI_API_URL_PREFIX, api_model, api_key
    );

    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| AppError::Rewrite(format!("Failed to call Gemini API: {}", e)))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Rewrite(format!(
            "Gemini API returned {}: {}",
            status, body
        )));
    }

    let gemini_response: GeminiResponse = response
        .json()
        .await
        .map_err(|e| AppError::Rewrite(format!("Failed to parse Gemini response: {}", e)))?;

    if let Some(error) = gemini_response.error {
        return Err(AppError::Rewrite(format!(
            "Gemini API error: {}",
            error.message
        )));
    }

    let usage = gemini_response.usage_metadata.unwrap_or_default();
    let text = gemini_response
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content.parts.into_iter().next())
        .and_then(|p| p.text)
        .ok_or_else(|| AppError::Rewrite("Empty response from Gemini".into()))?;

    let text = text.trim().to_string();
    log::info!(
        "Gemini returned {} chars (prompt={}, output={})",
        text.chars().count(),
        usage.prompt_token_count,
        usage.candidates_token_count,
    );
    Ok(RewriteOutcome {
        text,
        prompt_tokens: usage.prompt_token_count,
        completion_tokens: usage.candidates_token_count,
    })
}

pub async fn validate_api_key(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
) -> AppResult<()> {
    let _ = rewrite(
        client,
        api_key,
        model,
        "You are a validator. Reply with exactly: OK",
        "Return OK",
    )
    .await?;
    Ok(())
}
