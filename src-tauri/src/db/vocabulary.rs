use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VocabularyTerm {
    pub id: i64,
    pub term: String,
    pub phonetic: Option<String>,
    pub definition: Option<String>,
    pub category: String,
    pub use_count: i64,
    pub created_at: String,
}

pub fn get_all(conn: &Connection) -> AppResult<Vec<VocabularyTerm>> {
    let mut stmt = conn.prepare(
        "SELECT id, term, phonetic, definition, category, use_count, created_at
         FROM vocabulary
         ORDER BY use_count DESC, term ASC",
    )?;

    let terms = stmt
        .query_map([], |row| {
            Ok(VocabularyTerm {
                id: row.get(0)?,
                term: row.get(1)?,
                phonetic: row.get(2)?,
                definition: row.get(3)?,
                category: row.get(4)?,
                use_count: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(terms)
}

pub fn add_term(
    conn: &Connection,
    term: &str,
    phonetic: Option<&str>,
    definition: Option<&str>,
    category: &str,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO vocabulary (term, phonetic, definition, category) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![term, phonetic, definition, category],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_term(
    conn: &Connection,
    id: i64,
    term: &str,
    phonetic: Option<&str>,
    definition: Option<&str>,
    category: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE vocabulary SET term = ?1, phonetic = ?2, definition = ?3, category = ?4, updated_at = datetime('now') WHERE id = ?5",
        rusqlite::params![term, phonetic, definition, category, id],
    )?;
    Ok(())
}

pub fn delete_term(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM vocabulary WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}

pub fn increment_use_count(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE vocabulary SET use_count = use_count + 1 WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}
