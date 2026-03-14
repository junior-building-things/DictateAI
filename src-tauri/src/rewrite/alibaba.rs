use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    extra_body: Option<Value>,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

pub async fn rewrite(
    api_key: &str,
    base_url: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> AppResult<String> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config(
            "Alibaba rewrite requires alibaba_api_key in settings.".into(),
        ));
    }

    let request = ChatCompletionRequest {
        model: if model.trim().is_empty() {
            "qwen2.5-7b-instruct".to_string()
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
        extra_body: if model == "qwen3-8b" {
            Some(json!({ "enable_thinking": false }))
        } else {
            None
        },
    };

    let endpoint = compatible_chat_completions_url(base_url);
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::Rewrite(format!("Alibaba rewrite request failed: {}", error)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Rewrite(format!(
            "Alibaba rewrite API returned {}: {}",
            status, body
        )));
    }

    let parsed: Value = response.json().await.map_err(|error| {
        AppError::Rewrite(format!("Failed to parse Alibaba response: {}", error))
    })?;

    extract_text(&parsed)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| AppError::Rewrite("Empty response from Alibaba rewrite.".into()))
}

pub async fn validate_api_key(api_key: &str, base_url: &str, model: &str) -> AppResult<()> {
    let _ = rewrite(
        api_key,
        base_url,
        model,
        "You are a validator. Reply with exactly: OK",
        "Return OK",
    )
    .await?;

    Ok(())
}

fn compatible_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

fn extract_text(value: &Value) -> Option<String> {
    let content = value.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    content.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
    })
}
