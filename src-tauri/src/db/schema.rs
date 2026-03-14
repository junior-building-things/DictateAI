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
            favorited   INTEGER NOT NULL DEFAULT 0
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
            ('rewrite_model', 'gemini-2.5-flash-lite'),
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
            ('hotkey', 'CommandOrControl+S'),
            ('hotkey_mode', 'hold'),
            ('speech_model', 'deepgram-nova-3'),
            ('speech_provider', 'Deepgram'),
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
            ('sound_enabled', 'true'),
            ('max_recording_seconds', '120');

        UPDATE settings SET value = 'Deepgram'
            WHERE key = 'speech_provider'
              AND value IN ('Browser', 'OpenAI');

        UPDATE settings SET value = 'deepgram-nova-3'
            WHERE key = 'speech_model'
              AND value IN ('gpt-4o-mini-transcribe', 'gpt-4o-transcribe', '');

        UPDATE settings SET value = 'Google'
            WHERE key = 'rewrite_provider'
              AND value = 'Local Cleanup';

        UPDATE settings SET value = 'gpt-4.1-mini'
            WHERE key = 'rewrite_model'
              AND value IN ('gpt-4o-mini', 'gpt-4.1');
        ",
    )?;

    ensure_history_favorited_column(conn)?;

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
