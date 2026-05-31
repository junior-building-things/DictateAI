use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Serialize, Clone)]
pub struct HistoryEntry {
    pub id: i64,
    pub raw_text: String,
    pub rewritten: String,
    pub model_used: String,
    pub duration_ms: i64,
    pub created_at: String,
    pub favorited: bool,
    /// Combined input + output rewrite-model tokens reported by the API,
    /// or 0 for local / Apple FM rewrites where there's no notion of tokens.
    pub tokens: i64,
    /// Total USD spent on this dictation: speech-phase per-minute charge
    /// plus rewrite-phase per-token charge. 0.0 for fully-local pipelines.
    #[serde(rename = "cost")]
    pub cost_usd: f64,
}

#[derive(Debug, Clone)]
pub struct FavoriteRewriteExample {
    pub raw_text: String,
    pub rewritten: String,
}

pub fn insert_entry(
    conn: &Connection,
    raw_text: &str,
    rewritten: &str,
    model_used: &str,
    duration_ms: i64,
    tokens: i64,
    cost_usd: f64,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO transcription_history (raw_text, rewritten, model_used, duration_ms, tokens, cost_usd)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![raw_text, rewritten, model_used, duration_ms, tokens, cost_usd],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_page(
    conn: &Connection,
    page: usize,
    per_page: usize,
) -> AppResult<(Vec<HistoryEntry>, usize)> {
    let total: usize = conn.query_row("SELECT COUNT(*) FROM transcription_history", [], |row| {
        row.get(0)
    })?;

    let offset = page * per_page;
    let mut stmt = conn.prepare(
        "SELECT id, raw_text, rewritten, model_used, duration_ms, created_at, favorited,
                tokens, cost_usd
         FROM transcription_history
         ORDER BY created_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;

    let entries = stmt
        .query_map(rusqlite::params![per_page, offset], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                raw_text: row.get(1)?,
                rewritten: row.get(2)?,
                model_used: row.get(3)?,
                duration_ms: row.get(4)?,
                created_at: row.get(5)?,
                favorited: row.get::<_, i64>(6)? != 0,
                tokens: row.get(7)?,
                cost_usd: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok((entries, total))
}

pub fn delete_entry(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM transcription_history WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}

pub fn update_rewritten_text(conn: &Connection, id: i64, rewritten: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE transcription_history SET rewritten = ?1 WHERE id = ?2",
        rusqlite::params![rewritten, id],
    )?;
    Ok(())
}

pub fn update_favorite(conn: &Connection, id: i64, favorited: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE transcription_history SET favorited = ?1 WHERE id = ?2",
        rusqlite::params![if favorited { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn get_favorite_examples(
    conn: &Connection,
    limit: usize,
) -> AppResult<Vec<FavoriteRewriteExample>> {
    let mut stmt = conn.prepare(
        "SELECT raw_text, rewritten
         FROM transcription_history
         WHERE favorited = 1
         ORDER BY created_at DESC
         LIMIT ?1",
    )?;

    let entries = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(FavoriteRewriteExample {
                raw_text: row.get(0)?,
                rewritten: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

pub fn clear_all(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM transcription_history", [])?;
    Ok(())
}

/// Auto-deletion sweep: drop history rows older than `days` days, *unless*
/// they're starred (`favorited = 1`). Returns the number of rows deleted
/// so the caller can log it. SQLite handles the date math via the modifier
/// arithmetic in `datetime(...)`, which compares lexicographically against
/// the ISO-8601 `created_at` values we store.
pub fn prune_unstarred_older_than(conn: &Connection, days: u32) -> AppResult<usize> {
    let modifier = format!("-{} days", days);
    let deleted = conn.execute(
        "DELETE FROM transcription_history
         WHERE favorited = 0
           AND created_at < datetime('now', ?1)",
        rusqlite::params![modifier],
    )?;
    Ok(deleted)
}
