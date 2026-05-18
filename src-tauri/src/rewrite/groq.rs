use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const GROQ_CHAT_COMPLETIONS_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

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
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

pub async fn rewrite(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> AppResult<String> {
    if api_key.trim().is_empty() {
        return Err(AppError::Config(
            "Groq rewrite requires groq_api_key in settings.".into(),
        ));
    }

    let request = ChatCompletionRequest {
        model: if model.trim().is_empty() {
            "llama-3.3-70b-versatile".to_string()
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
        .post(GROQ_CHAT_COMPLETIONS_URL)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| AppError::Rewrite(format!("Groq rewrite request failed: {}", error)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Rewrite(format!(
            "Groq rewrite API returned {}: {}",
            status, body
        )));
    }

    let parsed: ChatCompletionResponse = response
        .json()
        .await
        .map_err(|error| AppError::Rewrite(format!("Failed to parse Groq response: {}", error)))?;

    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content.trim().to_string())
        .unwrap_or_default();

    Ok(content)
}

pub async fn validate_api_key(client: &reqwest::Client, api_key: &str) -> AppResult<()> {
    let _ = rewrite(
        client,
        api_key,
        "llama-3.1-8b-instant",
        "You are a validator. Reply with exactly: OK",
        "Return OK",
    )
    .await?;

    Ok(())
}
