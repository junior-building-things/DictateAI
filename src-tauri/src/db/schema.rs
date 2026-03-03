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
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
            ('gemini_api_key', ''),
            ('model_mode', 'api'),
            ('rewrite_model', 'gemini-2.5-flash-lite'),
            ('rewrite_system_prompt', ''),
            ('hotkey', 'CommandOrControl+S'),
            ('speech_model', 'gpt-4o-mini-transcribe'),
            ('speech_openai_api_key', ''),
            ('speech_google_api_key', ''),
            ('speech_google_project_id', ''),
            ('speech_google_region', 'us'),
            ('speech_doubao_access_token', ''),
            ('speech_doubao_app_id', ''),
            ('speech_doubao_cluster', 'byteplus_input'),
            ('whisper_model', 'base.en'),
            ('language', 'en'),
            ('interface_language', 'en'),
            ('translation_language', 'same'),
            ('max_history_context', '10'),
            ('auto_paste', 'true'),
            ('sound_enabled', 'true'),
            ('max_recording_seconds', '120');
        ",
    )?;

    Ok(())
}
