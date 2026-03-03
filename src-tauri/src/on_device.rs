use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use futures_util::StreamExt;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::transcribe::whisper::WhisperTranscriber;

const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const LLAMA_MODEL_URL: &str =
    "https://huggingface.co/osanseviero/TinyLlama-1.1B-Chat-v1.0-Q4_K_M-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf";
const WHISPER_MODEL_FILE: &str = "ggml-base.bin";
const LLAMA_MODEL_FILE: &str = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnDeviceStatus {
    pub ready: bool,
    pub models_downloaded: bool,
    pub whisper_downloaded: bool,
    pub llama_downloaded: bool,
    pub llama_runtime_available: bool,
}

pub fn status(app: &AppHandle) -> AppResult<OnDeviceStatus> {
    let whisper_downloaded = whisper_model_path(app)?.exists();
    let llama_downloaded = llama_model_path(app)?.exists();
    let models_downloaded = whisper_downloaded && llama_downloaded;
    let llama_runtime_available = resolve_llama_cli().is_some();

    Ok(OnDeviceStatus {
        ready: models_downloaded && llama_runtime_available,
        models_downloaded,
        whisper_downloaded,
        llama_downloaded,
        llama_runtime_available,
    })
}

pub async fn download_models(app: &AppHandle) -> AppResult<OnDeviceStatus> {
    let whisper_path = whisper_model_path(app)?;
    let llama_path = llama_model_path(app)?;

    if !whisper_path.exists() {
        download_file(WHISPER_MODEL_URL, &whisper_path).await?;
    }
    if !llama_path.exists() {
        download_file(LLAMA_MODEL_URL, &llama_path).await?;
    }

    status(app)
}

pub fn remove_models(app: &AppHandle) -> AppResult<OnDeviceStatus> {
    let whisper_path = whisper_model_path(app)?;
    let llama_path = llama_model_path(app)?;

    remove_if_exists(&whisper_path)?;
    remove_if_exists(&llama_path)?;

    status(app)
}

pub async fn transcribe(app: &AppHandle, audio: Vec<f32>, language: String) -> AppResult<String> {
    let model_path = whisper_model_path(app)?;
    if !model_path.exists() {
        return Err(AppError::Config(
            "On-device speech model is not downloaded yet.".into(),
        ));
    }

    tokio::task::spawn_blocking(move || -> AppResult<String> {
        let transcriber = WhisperTranscriber::new();
        transcriber.load_model(&model_path)?;
        transcriber.transcribe(&audio, &language)
    })
    .await
    .map_err(|e| AppError::Transcription(format!("On-device transcription task failed: {}", e)))?
}

pub async fn rewrite(
    app: &AppHandle,
    system_prompt: String,
    user_message: String,
) -> AppResult<String> {
    let model_path = llama_model_path(app)?;
    if !model_path.exists() {
        return Err(AppError::Config(
            "On-device rewrite model is not downloaded yet.".into(),
        ));
    }

    let cli_path = resolve_llama_cli().ok_or_else(|| {
        AppError::Config(
            "On-device rewrite requires the bundled llama.cpp runtime. Reinstall the app or redownload the sidecar-enabled build.".into(),
        )
    })?;

    tokio::task::spawn_blocking(move || -> AppResult<String> {
        run_llama_cli(&cli_path, &model_path, &system_prompt, &user_message)
    })
    .await
    .map_err(|e| AppError::Rewrite(format!("On-device rewrite task failed: {}", e)))?
}

fn run_llama_cli(
    binary_path: &Path,
    model_path: &Path,
    system_prompt: &str,
    user_message: &str,
) -> AppResult<String> {
    let output = Command::new(binary_path)
        .arg("-m")
        .arg(model_path)
        .arg("--device")
        .arg("none")
        .arg("-c")
        .arg("4096")
        .arg("-n")
        .arg("384")
        .arg("--simple-io")
        .arg("--log-disable")
        .arg("-cnv")
        .arg("-st")
        .arg("--no-display-prompt")
        .arg("--no-show-timings")
        .arg("-sys")
        .arg(system_prompt)
        .arg("-p")
        .arg(user_message)
        .output()
        .map_err(|e| AppError::Rewrite(format!("Failed to launch llama.cpp: {}", e)))?;

    finalize_llama_output(output)
}

fn finalize_llama_output(output: std::process::Output) -> AppResult<String> {
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = normalize_terminal_output(&format!("{}\n{}", stderr, stdout));
        return Err(AppError::Rewrite(format!(
            "llama.cpp failed: {}",
            detail.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = sanitize_llama_output(&stdout, &stderr);
    if text.is_empty() {
        return Err(AppError::Rewrite(
            "llama.cpp returned an empty response.".into(),
        ));
    }

    Ok(text)
}

fn sanitize_llama_output(stdout: &str, stderr: &str) -> String {
    let merged = normalize_terminal_output(&format!("{}\n{}", stdout, stderr));

    for line in merged.lines().rev() {
        let trimmed = normalize_model_line(line);
        if let Some(value) = trimmed.strip_prefix("Cleaned:") {
            return strip_surrounding_quotes(value.trim()).to_string();
        }
    }

    merged
        .lines()
        .filter_map(|line| {
            let trimmed = normalize_model_line(line);
            let keep = !trimmed.is_empty()
                && trimmed != "Exiting..."
                && !trimmed.starts_with("Loading model")
                && !trimmed.starts_with("using custom system prompt")
                && !trimmed.starts_with("available commands:")
                && !trimmed.starts_with("build:")
                && !trimmed.starts_with("main:")
                && !trimmed.starts_with("model      :")
                && !trimmed.starts_with("modalities :")
                && !trimmed.starts_with("llama_")
                && !trimmed.starts_with("sampling:")
                && !trimmed.starts_with("srv ")
                && !trimmed.starts_with("[ Prompt:")
                && !trimmed.starts_with("/exit")
                && !trimmed.starts_with("/regen")
                && !trimmed.starts_with("/clear")
                && !trimmed.starts_with("/read")
                && !trimmed.starts_with("System instruction:")
                && !trimmed.starts_with("User input:")
                && !trimmed.starts_with("Raw:")
                && !trimmed.starts_with("Return only the final rewritten text.")
                && !trimmed.starts_with("ggml_")
                && !trimmed.starts_with("llama_")
                && !trimmed.starts_with("error:")
                && !trimmed.chars().all(|c| c == '▄' || c == '█' || c == '▀');

            keep.then_some(trimmed)
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn normalize_model_line(line: &str) -> &str {
    line.trim().trim_start_matches('>').trim()
}

fn normalize_terminal_output(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        match ch {
            '\u{0008}' => {
                out.pop();
            }
            '\r' => {}
            _ => out.push(ch),
        }
    }
    out
}

fn strip_surrounding_quotes(input: &str) -> &str {
    input
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(input)
}

fn resolve_llama_cli() -> Option<PathBuf> {
    if let Some(candidate) = bundled_sidecar_path().filter(|path| path.exists()) {
        return Some(candidate);
    }

    #[cfg(target_os = "macos")]
    {
        let homebrew_cli = PathBuf::from("/opt/homebrew/opt/llama.cpp/bin/llama-cli");
        if homebrew_cli.exists() {
            return Some(homebrew_cli);
        }
    }

    for candidate in ["llama-cli", "llama"] {
        if Command::new(candidate).arg("--version").output().is_ok() {
            return Some(PathBuf::from(candidate));
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn bundled_sidecar_path() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    let is_bundle = exe_path
        .to_string_lossy()
        .contains(".app/Contents/MacOS/");
    if !is_bundle {
        return None;
    }

    exe_path
        .parent()
        .map(|dir| dir.join(bundled_sidecar_name()))
}

#[cfg(not(target_os = "macos"))]
fn bundled_sidecar_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|dir| dir.join(bundled_sidecar_name())))
}

#[cfg(target_os = "windows")]
fn bundled_sidecar_name() -> &'static str {
    "llama-cli.exe"
}

#[cfg(not(target_os = "windows"))]
fn bundled_sidecar_name() -> &'static str {
    "llama-cli"
}

fn models_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?
        .join("models");
    Ok(dir)
}

fn whisper_model_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(models_dir(app)?.join(WHISPER_MODEL_FILE))
}

fn llama_model_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(models_dir(app)?.join(LLAMA_MODEL_FILE))
}

async fn download_file(url: &str, destination: &Path) -> AppResult<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }

    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Http(e))?;

    if !response.status().is_success() {
        return Err(AppError::Config(format!(
            "Failed to download model from {} ({}).",
            url,
            response.status()
        )));
    }

    let temp_path = destination.with_extension("download");
    let mut file = File::create(&temp_path)?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(AppError::Http)?;
        file.write_all(&chunk)?;
    }

    file.flush()?;
    fs::rename(temp_path, destination)?;
    Ok(())
}

fn remove_if_exists(path: &Path) -> AppResult<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}
