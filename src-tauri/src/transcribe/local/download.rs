use std::fs;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};

/// How the model is packaged at the source URL.
#[derive(Debug, Clone)]
pub enum LocalArtifact {
    /// A `.tar.bz2` whose top-level directory is `archive_root`. We strip that
    /// prefix when extracting so files land directly under `<models>/<id>/`.
    TarBz2 { archive_root: &'static str },
    /// A single file (typically a `.gguf` for LLMs) saved as `<models>/<id>/<filename>`.
    DirectFile { filename: &'static str },
}

/// One installable on-device model (STT or LLM).
#[derive(Debug, Clone)]
pub struct LocalModelSpec {
    /// Stable id used in settings (e.g. `parakeet-tdt-0.6b-v2-int8`).
    pub id: &'static str,
    /// User-facing label shown in the model picker.
    pub label: &'static str,
    /// Source URL to download from.
    pub url: &'static str,
    pub artifact: LocalArtifact,
}

pub const PARAKEET_TDT_06B_V2_INT8: LocalModelSpec = LocalModelSpec {
    id: "parakeet-tdt-0.6b-v2-int8",
    label: "Parakeet TDT 0.6B v2 (int8)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
    artifact: LocalArtifact::TarBz2 {
        archive_root: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    },
};

pub const LLAMA_3_2_1B_INSTRUCT_Q4KM: LocalModelSpec = LocalModelSpec {
    id: "llama-3.2-1b-instruct-q4km",
    label: "Llama 3.2 1B Instruct (Q4_K_M)",
    url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    artifact: LocalArtifact::DirectFile {
        filename: "model.gguf",
    },
};

pub const GEMMA_3_1B_IT_Q4KM: LocalModelSpec = LocalModelSpec {
    id: "gemma-3-1b-it-q4km",
    label: "Gemma 3 1B IT (Q4_K_M)",
    url: "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf",
    artifact: LocalArtifact::DirectFile {
        filename: "model.gguf",
    },
};

pub fn known_models() -> &'static [LocalModelSpec] {
    &[
        PARAKEET_TDT_06B_V2_INT8,
        LLAMA_3_2_1B_INSTRUCT_Q4KM,
        GEMMA_3_1B_IT_Q4KM,
    ]
}

pub fn find_model(id: &str) -> Option<&'static LocalModelSpec> {
    known_models().iter().find(|m| m.id == id)
}

/// For `DirectFile` artifacts, the on-disk path to the downloaded file.
pub fn direct_file_path(app_data_dir: &Path, spec: &LocalModelSpec) -> Option<PathBuf> {
    match &spec.artifact {
        LocalArtifact::DirectFile { filename } => Some(model_dir(app_data_dir, spec).join(filename)),
        LocalArtifact::TarBz2 { .. } => None,
    }
}

/// Resolve `<app_data_dir>/models/<spec.id>` — the destination for a model's
/// extracted ONNX files.
pub fn model_dir(app_data_dir: &Path, spec: &LocalModelSpec) -> PathBuf {
    app_data_dir.join("models").join(spec.id)
}

/// Download `spec` under `app_data_dir/models/`. For `TarBz2`, extract and
/// strip the wrapper directory. For `DirectFile`, save the body at
/// `<models>/<id>/<filename>`. Emits `local-model-progress` events with
/// `{ id, phase, bytes_done, bytes_total }`.
pub async fn install_model(
    app: &AppHandle,
    http: &reqwest::Client,
    app_data_dir: &Path,
    spec: &LocalModelSpec,
) -> AppResult<PathBuf> {
    let models_dir = app_data_dir.join("models");
    fs::create_dir_all(&models_dir)
        .map_err(|e| AppError::Config(format!("Create models dir failed: {}", e)))?;
    let target_dir = models_dir.join(spec.id);
    fs::create_dir_all(&target_dir)
        .map_err(|e| AppError::Config(format!("Create target dir failed: {}", e)))?;

    match &spec.artifact {
        LocalArtifact::TarBz2 { archive_root } => {
            let archive_path = models_dir.join(format!("{}.tar.bz2", spec.id));
            download_to_file(app, http, spec, &archive_path).await?;

            emit_progress(app, spec, "extracting", 0, None);
            let archive_path_cloned = archive_path.clone();
            let models_dir_cloned = models_dir.clone();
            let archive_root = archive_root.to_string();
            let target_name = spec.id.to_string();
            tokio::task::spawn_blocking(move || {
                extract_tar_bz2_stripping_root(
                    &archive_path_cloned,
                    &models_dir_cloned,
                    &archive_root,
                    &target_name,
                )
            })
            .await
            .map_err(|e| AppError::Config(format!("Extraction task join failed: {}", e)))??;

            let _ = fs::remove_file(&archive_path);
        }
        LocalArtifact::DirectFile { filename } => {
            let dest = target_dir.join(filename);
            download_to_file(app, http, spec, &dest).await?;
        }
    }

    emit_progress(app, spec, "ready", 0, None);
    Ok(target_dir)
}

async fn download_to_file(
    app: &AppHandle,
    http: &reqwest::Client,
    spec: &LocalModelSpec,
    dest: &Path,
) -> AppResult<()> {
    emit_progress(app, spec, "downloading", 0, None);
    let response = http
        .get(spec.url)
        .send()
        .await
        .map_err(|e| AppError::Config(format!("Model download request failed: {}", e)))?
        .error_for_status()
        .map_err(|e| AppError::Config(format!("Model download HTTP error: {}", e)))?;

    let total = response.content_length();
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| AppError::Config(format!("Create file failed: {}", e)))?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| AppError::Config(format!("Model download stream error: {}", e)))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Config(format!("Write failed: {}", e)))?;
        downloaded += chunk.len() as u64;
        emit_progress(app, spec, "downloading", downloaded, total);
    }
    file.flush()
        .await
        .map_err(|e| AppError::Config(format!("Flush failed: {}", e)))?;
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    spec: &LocalModelSpec,
    phase: &str,
    bytes_done: u64,
    bytes_total: Option<u64>,
) {
    #[derive(serde::Serialize, Clone)]
    struct Progress<'a> {
        id: &'a str,
        phase: &'a str,
        bytes_done: u64,
        bytes_total: Option<u64>,
    }
    let _ = app.emit(
        "local-model-progress",
        Progress {
            id: spec.id,
            phase,
            bytes_done,
            bytes_total,
        },
    );
}

/// Extract a `.tar.bz2` archive into `models_dir/<target_name>/`, stripping the
/// top-level directory `archive_root` that the upstream tarball wraps things in.
fn extract_tar_bz2_stripping_root(
    archive_path: &Path,
    models_dir: &Path,
    archive_root: &str,
    target_name: &str,
) -> AppResult<()> {
    use bzip2::read::BzDecoder;
    use std::fs::File;
    use std::io::BufReader;
    use tar::Archive;

    let file = File::open(archive_path)
        .map_err(|e| AppError::Config(format!("Open archive failed: {}", e)))?;
    let decoder = BzDecoder::new(BufReader::new(file));
    let mut archive = Archive::new(decoder);

    let target_root = models_dir.join(target_name);
    fs::create_dir_all(&target_root)
        .map_err(|e| AppError::Config(format!("Create target dir failed: {}", e)))?;

    let archive_root_prefix = format!("{}/", archive_root);

    for entry in archive
        .entries()
        .map_err(|e| AppError::Config(format!("Read tar entries failed: {}", e)))?
    {
        let mut entry =
            entry.map_err(|e| AppError::Config(format!("Read tar entry failed: {}", e)))?;
        let path = entry
            .path()
            .map_err(|e| AppError::Config(format!("Entry path failed: {}", e)))?
            .into_owned();
        let path_str = path.to_string_lossy();

        // Strip the upstream top-level dir; skip the dir entry itself.
        let stripped = if let Some(rest) = path_str.strip_prefix(&archive_root_prefix) {
            rest.to_string()
        } else if path_str.as_ref() == archive_root || path_str.as_ref() == archive_root_prefix {
            continue;
        } else {
            // Tar that doesn't have the expected wrapper dir — preserve as-is.
            path_str.into_owned()
        };

        if stripped.is_empty() {
            continue;
        }

        let dest = target_root.join(&stripped);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Config(format!("Create dir failed: {}", e)))?;
        }
        entry
            .unpack(&dest)
            .map_err(|e| AppError::Config(format!("Unpack failed for {}: {}", stripped, e)))?;
    }

    Ok(())
}
