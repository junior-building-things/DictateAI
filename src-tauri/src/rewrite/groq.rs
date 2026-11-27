use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::rewrite::RewriteOutcome;

const GROQ_CHAT_COMPLETIONS_URL: &str = "https://api.groq.com/openai/v1/chat/completions";

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    /// GPT-OSS always reasons; "low" keeps that short, and leaving the
    /// reasoning out of the response keeps `content` to the cleaned text.
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_reasoning: Option<bool>,
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
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: Option<String>,
}

#[derive(Deserialize, Default)]
struct TokenUsage {
    #[serde(default)]
    prompt_tokens: Option<u32>,
    #[serde(default)]
    completion_tokens: Option<u32>,
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
            "Groq rewrite requires groq_api_key in settings.".into(),
        ));
    }

    let model = if model.trim().is_empty() {
        "openai/gpt-oss-20b"
    } else {
        model
    };
    let is_gpt_oss = model.starts_with("openai/gpt-oss");
    let request = ChatCompletionRequest {
        model: model.to_string(),
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
        reasoning_effort: is_gpt_oss.then_some("low"),
        include_reasoning: is_gpt_oss.then_some(false),
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

    let body = response
        .bytes()
        .await
        .map_err(|error| AppError::Rewrite(format!("Failed to read Groq response: {}", error)))?;

    parse_response(&body)
}

fn parse_response(body: &[u8]) -> AppResult<RewriteOutcome> {
    // Parse separately so serde's specific error isn't hidden by reqwest.
    let parsed: ChatCompletionResponse = serde_json::from_slice(body)
        .map_err(|error| AppError::Rewrite(format!("Failed to parse Groq response: {}", error)))?;

    let usage = parsed.usage.unwrap_or_default();
    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Rewrite("Groq returned no rewrite choices.".into()))?;
    let text = choice
        .message
        .content
        .unwrap_or_default()
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(AppError::Rewrite(format!(
            "Groq returned no rewrite text (finish reason: {}).",
            choice.finish_reason.as_deref().unwrap_or("unknown")
        )));
    }

    Ok(RewriteOutcome {
        text,
        prompt_tokens: usage.prompt_tokens.unwrap_or_default(),
        completion_tokens: usage.completion_tokens.unwrap_or_default(),
    })
}

pub async fn validate_api_key(client: &reqwest::Client, api_key: &str) -> AppResult<()> {
    let _ = rewrite(
        client,
        api_key,
        "openai/gpt-oss-20b",
        "You are a validator. Reply with exactly: OK",
        "Return OK",
    )
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_null_token_counts() {
        let response: ChatCompletionResponse = serde_json::from_str(
            r#"{
                "choices": [{"message": {"content": "Hello."}}],
                "usage": {"prompt_tokens": null, "completion_tokens": null}
            }"#,
        )
        .expect("Optional usage metadata must not discard a valid rewrite");
        assert_eq!(response.choices.len(), 1);

        let outcome = parse_response(
            br#"{
                "choices": [{"message": {"content": "Hello."}}],
                "usage": {"prompt_tokens": null, "completion_tokens": null}
            }"#,
        )
        .unwrap();
        assert_eq!(outcome.text, "Hello.");
        assert_eq!(outcome.total_tokens(), 0);
    }

    #[test]
    fn accepts_nullable_message_content() {
        let response: ChatCompletionResponse = serde_json::from_str(
            r#"{
                "choices": [{
                    "message": {"content": null, "reasoning": "Internal reasoning"},
                    "finish_reason": "length"
                }]
            }"#,
        )
        .expect("A missing final answer needs a specific error, not a decoding failure");
        assert_eq!(response.choices.len(), 1);
    }

    #[test]
    fn parses_rewrite_and_usage_without_reasoning() {
        let outcome = parse_response(
            br#"{
                "choices": [{
                    "message": {"content": " Hello. ", "reasoning": "Internal reasoning"},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3}
            }"#,
        )
        .unwrap();
        assert_eq!(outcome.text, "Hello.");
        assert_eq!(outcome.prompt_tokens, 12);
        assert_eq!(outcome.completion_tokens, 3);
    }

    #[test]
    fn accepts_missing_or_null_usage() {
        for body in [
            br#"{"choices":[{"message":{"content":"OK"}}]}"#.as_slice(),
            br#"{"choices":[{"message":{"content":"OK"}}],"usage":null}"#.as_slice(),
            br#"{"choices":[{"message":{"content":"OK"}}],"usage":{}}"#.as_slice(),
        ] {
            let outcome = parse_response(body).unwrap();
            assert_eq!(outcome.text, "OK");
            assert_eq!(outcome.total_tokens(), 0);
        }
    }

    #[test]
    fn rejects_missing_or_empty_text_without_using_reasoning() {
        for content in [serde_json::Value::Null, serde_json::json!(" ")] {
            let body = serde_json::to_vec(&serde_json::json!({
                "choices": [{
                    "message": {"content": content, "reasoning": "Internal reasoning"},
                    "finish_reason": "length"
                }]
            }))
            .unwrap();
            let error = parse_response(&body).unwrap_err().to_string();
            assert!(error.contains("no rewrite text (finish reason: length)"));
            assert!(!error.contains("Internal reasoning"));
        }

        let error = parse_response(br#"{"choices":[{"message":{}}]}"#)
            .unwrap_err()
            .to_string();
        assert!(error.contains("no rewrite text (finish reason: unknown)"));
    }

    #[test]
    fn rejects_empty_choices() {
        let error = parse_response(br#"{"choices":[]}"#)
            .unwrap_err()
            .to_string();
        assert!(error.contains("no rewrite choices"));
    }

    #[test]
    fn reports_specific_json_error_without_response_body() {
        let error = parse_response(br#"{"choices":[]"#).unwrap_err().to_string();
        assert!(error.contains("EOF while parsing an object"));
        assert!(!error.contains("{\"choices\""));
    }
}
