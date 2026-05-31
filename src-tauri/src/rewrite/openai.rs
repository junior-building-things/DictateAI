use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::rewrite::RewriteOutcome;

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<TokenUsage>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

/// Shared shape across OpenAI-compatible chat completion APIs (OpenAI proper,
/// Groq, Alibaba DashScope) — all surface `usage.prompt_tokens` +
/// `usage.completion_tokens` on success. `#[serde(default)]` on each field
/// guards against responses that omit them in edge cases.
#[derive(Deserialize, Default)]
struct TokenUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

pub async fn rewrite(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> AppResult<RewriteOutcome> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config(
            "OpenAI rewrite requires speech_openai_api_key in settings.".into(),
        ));
    }

    let request = ChatCompletionRequest {
        model: if model.trim().is_empty() {
            "gpt-5-mini".to_string()
        } else {
            model.to_string()
        },
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_message.to_string(),
            },
        ],
        temperature: 0.2,
    };

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::Rewrite(format!("OpenAI rewrite request failed: {}", error)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Rewrite(format!(
            "OpenAI rewrite API returned {}: {}",
            status, body
        )));
    }

    let parsed: ChatCompletionResponse = response.json().await.map_err(|error| {
        AppError::Rewrite(format!("Failed to parse OpenAI response: {}", error))
    })?;

    let usage = parsed.usage.unwrap_or_default();
    let text = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content.trim().to_string())
        .unwrap_or_default();

    Ok(RewriteOutcome {
        text,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
    })
}
