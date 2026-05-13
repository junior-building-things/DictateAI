use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::error::{AppError, AppResult};

/// Path to the Swift helper binary, baked in at build time by `build.rs`.
/// `None` here means we couldn't compile the helper (no swiftc, no macOS 26
/// SDK, or compilation failed) — callers surface a clear error.
const HELPER_PATH: Option<&str> = option_env!("APPLE_FM_HELPER_PATH");

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

fn helper_path() -> AppResult<&'static str> {
    HELPER_PATH.ok_or_else(|| {
        AppError::Config(
            "Apple Foundation Models helper wasn't built. Requires macOS 26+ with swiftc \
             available at compile time."
                .into(),
        )
    })
}

pub async fn check_availability() -> Availability {
    let Some(path) = HELPER_PATH else {
        return Availability::NotBuilt;
    };
    let spawn = Command::new(path).arg("--check").output();
    match timeout(CHECK_TIMEOUT, spawn).await {
        Ok(Ok(out)) if out.status.success() => Availability::Available,
        _ => Availability::Unavailable,
    }
}

pub async fn rewrite(system: &str, user: &str) -> AppResult<String> {
    let path = helper_path()?;
    let input_json = serde_json::to_vec(&Input { system, user })?;

    let mut child = Command::new(path)
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
