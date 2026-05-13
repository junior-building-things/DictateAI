// Local LLM rewrite via llama.cpp with Metal acceleration on macOS.
//
// Implementation lands in slice 3. For now we expose the module so callers can
// reference the eventual API surface without circular wiring later.

use std::path::PathBuf;

use crate::error::{AppError, AppResult};

#[allow(dead_code)]
pub struct LocalLlmEngine {
    pub model_path: PathBuf,
}

#[allow(dead_code)]
impl LocalLlmEngine {
    pub fn load(model_path: PathBuf) -> AppResult<Self> {
        if !model_path.exists() {
            return Err(AppError::Config(format!(
                "Local LLM model not found at {}",
                model_path.display()
            )));
        }
        Ok(Self { model_path })
    }

    pub async fn rewrite(&self, _system_prompt: &str, _user_message: &str) -> AppResult<String> {
        Err(AppError::Config(
            "Local LLM rewrite is not implemented yet (slice 3).".into(),
        ))
    }
}
