use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Settings keys whose values are sensitive secrets (API keys, access
/// tokens). These are stored in the platform keystore (macOS Keychain)
/// rather than the SQLite settings table, so they're encrypted at rest and
/// not extractable from a stolen DB file.
///
/// Reads and writes through `get`/`set` route to the keystore transparently
/// when the key matches one of these; non-secret keys go to SQLite.
const SECRET_KEYS: &[&str] = &[
    "alibaba_api_key",
    "gemini_api_key",
    "groq_api_key",
    "speech_deepgram_api_key",
    "speech_nvidia_api_key",
    "speech_openai_api_key",
    "speech_google_api_key",
    "speech_doubao_access_token",
];

const KEYCHAIN_SERVICE: &str = "com.dictateai.app";

fn is_secret(key: &str) -> bool {
    SECRET_KEYS.contains(&key)
}

/// Keychain is enabled in release builds only. In `tauri dev` / `cargo build`
/// every rebuild changes the binary hash, which invalidates the per-item
/// "Always Allow" ACL — so the prompt comes back every code change. Release
/// builds are code-signed with a stable Developer ID, so the ACL persists and
/// users never see a prompt after the initial setup (most often not at all).
const fn use_keychain() -> bool {
    !cfg!(debug_assertions)
}

pub fn get(conn: &Connection, key: &str) -> AppResult<String> {
    if is_secret(key) && use_keychain() {
        return get_secret(key);
    }
    let value: String = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )?;
    Ok(value)
}

pub fn set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    if is_secret(key) && use_keychain() {
        return set_secret(key, value);
    }
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

pub fn get_all(conn: &Connection) -> AppResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let mut settings: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    // Overlay secret values from the Keychain on top of the DB rows. After
    // migration the DB stores blank strings for secret keys; callers like
    // Layout that check `settings.get("groq_api_key")` for presence would
    // otherwise see no key and incorrectly think the user hasn't configured
    // it. Each lookup is a single Keychain query (~sub-ms), negligible.
    // Skipped in debug builds since Keychain isn't used there.
    if use_keychain() {
        for (key, value) in settings.iter_mut() {
            if is_secret(key) {
                if let Ok(secret) = get_secret(key) {
                    *value = secret;
                }
            }
        }
    }

    Ok(settings)
}

/// Read a secret from the macOS Keychain. Returns an empty string when no
/// entry exists, mirroring the previous DB-backed behavior so callers that
/// check `.trim().is_empty()` still work.
fn get_secret(key: &str) -> AppResult<String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key)
        .map_err(|e| AppError::Config(format!("Keychain entry init failed for '{}': {}", key, e)))?;
    match entry.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(AppError::Config(format!(
            "Keychain read failed for '{}': {}",
            key, e
        ))),
    }
}

/// Write a secret to the macOS Keychain. An empty value deletes the entry
/// (also matching the previous DB-backed "set to empty string to clear"
/// semantics).
fn set_secret(key: &str, value: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key)
        .map_err(|e| AppError::Config(format!("Keychain entry init failed for '{}': {}", key, e)))?;
    if value.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Config(format!(
                "Keychain delete failed for '{}': {}",
                key, e
            ))),
        }
    } else {
        entry.set_password(value).map_err(|e| {
            AppError::Config(format!("Keychain write failed for '{}': {}", key, e))
        })
    }
}

/// One-time migration: move any non-empty secret values from the SQLite
/// settings table into the Keychain, then blank them out on disk. Safe to
/// call on every app start — it's a no-op if no DB-stored secret remains.
pub fn migrate_secrets_to_keychain(conn: &Connection) -> AppResult<()> {
    if !use_keychain() {
        // In debug builds we deliberately don't move secrets into Keychain
        // (avoids the per-rebuild ACL-reset prompt flood). Anything still in
        // the DB stays there.
        return Ok(());
    }
    for key in SECRET_KEYS {
        let row: Result<String, _> = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        );
        let Ok(existing) = row else {
            continue;
        };
        if existing.is_empty() {
            continue;
        }
        // Try to write to keychain first; only blank the DB after we're
        // confident the secret survives. Otherwise a transient keychain
        // failure could drop the user's API key on the floor.
        if let Err(e) = set_secret(key, &existing) {
            log::warn!(
                "Migration of '{}' to Keychain failed; leaving in DB for next attempt: {}",
                key,
                e
            );
            continue;
        }
        conn.execute(
            "UPDATE settings SET value = '' WHERE key = ?1",
            rusqlite::params![key],
        )?;
        log::info!("Migrated '{}' from DB to Keychain", key);
    }
    Ok(())
}
