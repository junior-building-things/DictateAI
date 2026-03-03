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
}

pub fn insert_entry(
    conn: &Connection,
    raw_text: &str,
    rewritten: &str,
    model_used: &str,
    duration_ms: i64,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO transcription_history (raw_text, rewritten, model_used, duration_ms) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![raw_text, rewritten, model_used, duration_ms],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_page(
    conn: &Connection,
    page: usize,
    per_page: usize,
) -> AppResult<(Vec<HistoryEntry>, usize)> {
    let total: usize = conn.query_row(
        "SELECT COUNT(*) FROM transcription_history",
        [],
        |row| row.get(0),
    )?;

    let offset = page * per_page;
    let mut stmt = conn.prepare(
        "SELECT id, raw_text, rewritten, model_used, duration_ms, created_at
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

pub fn clear_all(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM transcription_history", [])?;
    Ok(())
}
