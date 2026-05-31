pub mod alibaba;
#[cfg(target_os = "macos")]
pub mod apple_fm;
pub mod gemini;
pub mod groq;
pub mod local_cleanup;
pub mod local_llm;
pub mod openai;
pub mod prompt;

/// Outcome of a single rewrite call. `text` is the rewritten user-facing
/// string; the token counts are best-effort and come from each provider's
/// `usage` field (or equivalent). Providers without token telemetry —
/// Apple FM, local llama.cpp, the no-op `local_cleanup` fallback — return
/// zeros, which is the right value for the dashboard's "API usage" sum.
#[derive(Debug, Clone, Default)]
pub struct RewriteOutcome {
    pub text: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

impl RewriteOutcome {
    /// For local / offline providers that don't report token usage.
    pub fn local(text: String) -> Self {
        Self {
            text,
            prompt_tokens: 0,
            completion_tokens: 0,
        }
    }

    /// Total tokens across prompt + completion.
    pub fn total_tokens(&self) -> u32 {
        self.prompt_tokens.saturating_add(self.completion_tokens)
    }
}
