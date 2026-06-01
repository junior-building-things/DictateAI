use rusqlite::Connection;

use crate::error::AppResult;

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS transcription_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_text    TEXT NOT NULL,
            rewritten   TEXT NOT NULL,
            model_used  TEXT NOT NULL DEFAULT '',
            duration_ms INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            favorited   INTEGER NOT NULL DEFAULT 0,
            tokens      INTEGER NOT NULL DEFAULT 0,
            cost_usd    REAL NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_history_created_at
            ON transcription_history(created_at DESC);

        CREATE TABLE IF NOT EXISTS vocabulary (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            term        TEXT NOT NULL UNIQUE,
            phonetic    TEXT,
            definition  TEXT,
            category    TEXT DEFAULT 'general',
            use_count   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_vocabulary_term
            ON vocabulary(term);

        INSERT OR IGNORE INTO vocabulary (term, phonetic, definition, category) VALUES
            ('Aeolus', 'A-less', 'An internal dashboarding tool.', 'company'),
            ('Doubao', 'Doe-bao', 'AI model and chatbot platform by ByteDance.', 'company');

        CREATE TABLE IF NOT EXISTS settings (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('alibaba_api_key', ''),
            ('alibaba_base_url', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
            ('gemini_api_key', ''),
            ('groq_api_key', ''),
            ('rewrite_model', 'gemini-3.1-flash-lite'),
            ('rewrite_provider', 'Google'),
            ('rewrite_system_prompt', ''),
            ('rewrite_tone', 'neutral'),
            ('rewrite_use_vocabulary', 'true'),
            ('rewrite_use_favorites', 'false'),
            ('rewrite_remove_filler', 'true'),
            ('rewrite_remove_repeats', 'true'),
            ('rewrite_remove_corrections', 'true'),
            ('rewrite_preserve_wording', 'false'),
            ('rewrite_add_punctuation', 'true'),
            ('hotkey', 'Right Option'),
            ('hotkey_mode', 'hold'),
            ('speech_model', 'whisper-large-v3-turbo'),
            ('speech_provider', 'Groq'),
            ('speech_deepgram_api_key', ''),
            ('speech_nvidia_api_key', ''),
            ('speech_nvidia_base_url', 'http://127.0.0.1:9000'),
            ('speech_openai_api_key', ''),
            ('speech_google_api_key', ''),
            ('speech_google_project_id', ''),
            ('speech_google_region', 'us'),
            ('speech_doubao_access_token', ''),
            ('speech_doubao_app_id', ''),
            ('speech_doubao_cluster', 'byteplus_input'),
            ('language', 'en'),
            ('interface_language', 'en'),
            ('translation_language', 'same'),
            ('max_history_context', '10'),
            ('auto_copy', 'true'),
            ('auto_paste', 'true'),
            ('auto_add_vocabulary', 'true'),
            ('sound_enabled', 'true'),
            ('max_recording_seconds', '1200');

        -- Bump the old 2-minute cap to 20 minutes for existing installs.
        -- There's no UI for this key, so a stored '120' is always the prior
        -- default rather than a deliberate user choice.
        UPDATE settings SET value = '1200'
            WHERE key = 'max_recording_seconds' AND value = '120';

        UPDATE settings SET value = 'OpenAI'
            WHERE key = 'speech_provider'
              AND value IN ('Browser', 'NVIDIA', 'Doubao', 'BytePlus');

        UPDATE settings SET value = 'gpt-4o-mini-transcribe'
            WHERE key = 'speech_model'
              AND value IN ('', 'nvidia-parakeet-tdt-0.6b-v2', 'nvidia-canary-qwen-2.5b', 'doubao-byteplus');

        UPDATE settings SET value = 'nova-3'
            WHERE key = 'speech_model'
              AND value = 'deepgram-nova-3';

        UPDATE settings SET value = 'chirp_3'
            WHERE key = 'speech_model'
              AND value = 'google-chirp-3';

        UPDATE settings SET value = 'qwen3-asr-flash'
            WHERE key = 'speech_model'
              AND value = 'alibaba-qwen3-asr-flash';

        UPDATE settings SET value = 'Google'
            WHERE key = 'rewrite_provider'
              AND value = 'Local Cleanup';

        UPDATE settings SET value = 'gpt-5-mini'
            WHERE key = 'rewrite_model'
              AND value IN ('gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini');

        UPDATE settings SET value = 'gpt-5-nano'
            WHERE key = 'rewrite_model'
              AND value = 'gpt-4.1-nano';

        UPDATE settings SET value = 'qwen2.5-7b-instruct'
            WHERE key = 'rewrite_model'
              AND value = 'qwen3-8b';

        -- Migrate users off the bundled Llama 3.2 1B and Gemma 3 1B local
        -- rewrites (catalog entries removed). Land them on Apple Foundation
        -- Models, which is the closest in-spirit on-device replacement.
        UPDATE settings SET value = 'apple-fm-system'
            WHERE key = 'rewrite_model'
              AND value IN ('llama-3.2-1b-instruct-q4km', 'gemma-3-1b-it-q4km', 'local-llm');

        -- Speech: 'Local' provider replaced by per-vendor names. Parakeet is
        -- the only local speech model we ship today, so 'Local' implies NVIDIA.
        UPDATE settings SET value = 'NVIDIA'
            WHERE key = 'speech_provider'
              AND value = 'Local';

        -- Rewrite: 'Local' was either Apple FM or one of the now-removed
        -- llama.cpp GGUFs. Both end up at Apple now.
        UPDATE settings SET value = 'Apple'
            WHERE key = 'rewrite_provider'
              AND value = 'Local';

        -- Google renamed Gemini 3.1 Flash Lite out of preview; existing
        -- users on the old setting string get migrated to the new name.
        UPDATE settings SET value = 'gemini-3.1-flash-lite'
            WHERE key = 'rewrite_model'
              AND value = 'gemini-3.1-flash-lite-preview';
        ",
    )?;

    ensure_history_favorited_column(conn)?;
    ensure_history_usage_columns(conn)?;

    Ok(())
}

fn ensure_history_favorited_column(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(transcription_history)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if !columns.iter().any(|column| column == "favorited") {
        conn.execute(
            "ALTER TABLE transcription_history ADD COLUMN favorited INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    Ok(())
}

/// Backfill `tokens` and `cost_usd` columns on databases created before
/// usage telemetry was added. New rows go in with non-zero values for
/// API providers; existing rows stay at 0 (we have no way to compute
/// past costs after the fact).
fn ensure_history_usage_columns(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(transcription_history)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if !columns.iter().any(|column| column == "tokens") {
        conn.execute(
            "ALTER TABLE transcription_history ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !columns.iter().any(|column| column == "cost_usd") {
        conn.execute(
            "ALTER TABLE transcription_history ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0",
            [],
        )?;
    }

    Ok(())
}
