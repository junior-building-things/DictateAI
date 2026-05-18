use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::{AppError, AppResult};

/// Compile-time path to the Swift helper binary, written by `build.rs`.
/// Only useful in dev (`tauri dev`) — production .app bundles ship the
/// helper inside `Contents/Resources/binaries/` and resolve via
/// `current_exe()` below.
const HELPER_PATH_BUILD: Option<&str> = option_env!("APPLE_FM_HELPER_PATH");

const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const REWRITE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum Availability {
    Available,
    NotBuilt,
    Unavailable,
}

#[derive(serde::Serialize)]
struct Input<'a> {
    system: &'a str,
    user: &'a str,
}

/// Resolve the helper binary's location at runtime. Tries, in order:
///   1. `APPLE_FM_HELPER_PATH` env var (set by `build.rs` — works in dev).
///   2. `Contents/Resources/binaries/apple-fm-helper` next to the running
///      executable (the bundled location in a distributed .app).
fn resolve_helper_path() -> Option<PathBuf> {
    if let Some(p) = HELPER_PATH_BUILD {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        // exe = .../DictateAI.app/Contents/MacOS/dictateai
        // → .../DictateAI.app/Contents/Resources/binaries/apple-fm-helper
        let bundled = exe
            .parent()
            .and_then(Path::parent)
            .map(|c| c.join("Resources").join("binaries").join("apple-fm-helper"));
        if let Some(p) = bundled {
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

fn helper_path() -> AppResult<PathBuf> {
    resolve_helper_path().ok_or_else(|| {
        AppError::Config(
            "Apple Foundation Models helper wasn't found. The bundled binary is missing \
             — reinstall the app, or rebuild from source with swiftc + the macOS 26 SDK."
                .into(),
        )
    })
}

pub async fn check_availability() -> Availability {
    let Some(path) = resolve_helper_path() else {
        return Availability::NotBuilt;
    };
    let spawn = Command::new(&path).arg("--check").output();
    match timeout(CHECK_TIMEOUT, spawn).await {
        Ok(Ok(out)) if out.status.success() => Availability::Available,
        _ => Availability::Unavailable,
    }
}

pub async fn rewrite(system: &str, user: &str) -> AppResult<String> {
    let path = helper_path()?;
    let input_json = serde_json::to_vec(&Input { system, user })?;

    let mut child = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Config(format!("Spawn apple-fm-helper failed: {}", e)))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&input_json)
            .await
            .map_err(|e| AppError::Config(format!("Write to apple-fm-helper stdin: {}", e)))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| AppError::Config(format!("Close apple-fm-helper stdin: {}", e)))?;
    }

    let output = timeout(REWRITE_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            AppError::Config(format!(
                "Apple FM rewrite timed out after {} seconds.",
                REWRITE_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|e| AppError::Config(format!("apple-fm-helper wait failed: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Config(format!(
            "Apple FM helper exited {}: {}",
            output.status, stderr
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
