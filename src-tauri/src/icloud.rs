//! Syncs vocabulary and settings through the iCloud key-value store, so a new
//! Mac signed into the same Apple ID picks them up. History and API keys stay
//! on each Mac.
//!
//! Every item is its own key, so iCloud resolves conflicts per item (last
//! write wins) and one Mac's write never replaces another Mac's items:
//! - `s:<setting key>` holds a setting's value.
//! - `v:<lowercased term>` holds a vocabulary term as JSON; a missing key
//!   means the term was deleted.
//!
//! Without the iCloud entitlement (dev builds) the store still works, it just
//! never leaves this Mac.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{schema, settings, vocabulary};
use crate::state::AppState;

const SETTING_PREFIX: &str = "s:";
const TERM_PREFIX: &str = "v:";
/// iCloud rejects keys over 64 bytes.
const MAX_KEY_BYTES: usize = 64;
/// Settings row marking that this Mac has uploaded what it had before sync
/// existed. Never synced itself.
const SEEDED_KEY: &str = "icloud_seeded";

/// Tells the front end to reload settings and vocabulary.
pub const SYNCED_EVENT: &str = "icloud-synced";

#[derive(Serialize, Deserialize, PartialEq)]
struct TermPayload {
    term: String,
    phonetic: Option<String>,
    definition: Option<String>,
    category: String,
}

impl TermPayload {
    fn from_local(term: &vocabulary::VocabularyTerm) -> Self {
        Self {
            term: term.term.clone(),
            phonetic: term.phonetic.clone(),
            definition: term.definition.clone(),
            category: term.category.clone(),
        }
    }
}

fn synced_setting(key: &str) -> bool {
    !settings::is_secret(key) && key != SEEDED_KEY
}

fn term_key(term: &str) -> String {
    let mut key = format!("{TERM_PREFIX}{}", term.trim().to_lowercase());
    while key.len() > MAX_KEY_BYTES {
        key.pop();
    }
    key
}

// --- Pushing local changes ---

pub fn push_setting(key: &str, value: &str) {
    if synced_setting(key) {
        kv::set(&format!("{SETTING_PREFIX}{key}"), value);
    }
}

pub fn push_term(term: &vocabulary::VocabularyTerm) {
    if let Ok(json) = serde_json::to_string(&TermPayload::from_local(term)) {
        kv::set(&term_key(&term.term), &json);
    }
}

pub fn remove_term(term: &str) {
    kv::remove(&term_key(term));
}

// --- Applying remote changes ---

/// Pull everything at launch, upload what this Mac had before sync existed,
/// then follow changes from other Macs.
pub fn start(app: &AppHandle) {
    kv::synchronize();
    let remote_keys = kv::all_keys();
    let changed = apply_remote(app, &remote_keys, false);
    seed(app);
    if changed {
        let _ = app.emit(SYNCED_EVENT, ());
    }

    let handle = app.clone();
    kv::observe_external_changes(move |keys, deletions_allowed| {
        if apply_remote(&handle, &keys, deletions_allowed) {
            let _ = handle.emit(SYNCED_EVENT, ());
        }
    });
}

/// Applies the given remote keys to the local DB. A key with no remote value
/// deletes its term only when `deletions_allowed` — i.e. another Mac removed
/// it — never on an account switch, where every key vanishes at once.
/// Returns whether anything local changed.
fn apply_remote(app: &AppHandle, keys: &[String], deletions_allowed: bool) -> bool {
    let state = app.state::<AppState>();
    let mut changed = false;
    let mut new_hotkey = None;
    {
        let db = state.db.lock().unwrap();
        let local_terms = vocabulary::get_all(&db).unwrap_or_default();
        let local_settings = raw_settings(&db);

        for key in keys {
            if let Some(name) = key.strip_prefix(SETTING_PREFIX) {
                let Some(value) = kv::get(key) else { continue };
                if !synced_setting(name) || local_settings.get(name) == Some(&value) {
                    continue;
                }
                if name == "hotkey" {
                    // Needs re-registering, which takes the DB lock itself.
                    new_hotkey = Some(value);
                } else if settings::set(&db, name, &value).is_ok() {
                    changed = true;
                }
            } else if key.starts_with(TERM_PREFIX) {
                let local = local_terms.iter().find(|t| term_key(&t.term) == *key);
                match kv::get(key) {
                    Some(json) => {
                        let Ok(remote) = serde_json::from_str::<TermPayload>(&json) else {
                            continue;
                        };
                        changed |= upsert_term(&db, local, &remote);
                    }
                    None if deletions_allowed => {
                        if let Some(local) = local {
                            changed |= vocabulary::delete_term(&db, local.id).is_ok();
                        }
                    }
                    None => {}
                }
            }
        }
    }

    if let Some(hotkey) = new_hotkey {
        match crate::commands::update_hotkey(app.clone(), app.state::<AppState>(), hotkey) {
            Ok(()) => changed = true,
            Err(e) => log::warn!("iCloud: couldn't apply synced hotkey: {e}"),
        }
    }
    changed
}

fn upsert_term(
    db: &Connection,
    local: Option<&vocabulary::VocabularyTerm>,
    remote: &TermPayload,
) -> bool {
    let phonetic = remote.phonetic.as_deref();
    let definition = remote.definition.as_deref();
    match local {
        Some(local) if TermPayload::from_local(local) == *remote => false,
        Some(local) => vocabulary::update_term(
            db, local.id, &remote.term, phonetic, definition, &remote.category,
        )
        .is_ok(),
        None => vocabulary::add_term(db, &remote.term, phonetic, definition, &remote.category)
            .is_ok(),
    }
}

/// Once per Mac: upload settings and terms that iCloud doesn't have yet.
/// Anything still at its fresh-install default is skipped, so a brand-new Mac
/// whose iCloud data hasn't downloaded yet can't overwrite it with defaults.
fn seed(app: &AppHandle) {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    if settings::get(&db, SEEDED_KEY).is_ok() {
        return;
    }
    let Ok(defaults) = Connection::open_in_memory()
        .map_err(|e| e.to_string())
        .and_then(|c| schema::run_migrations(&c).map(|_| c).map_err(|e| e.to_string()))
    else {
        return;
    };
    let default_settings = raw_settings(&defaults);
    let default_terms: Vec<TermPayload> = vocabulary::get_all(&defaults)
        .unwrap_or_default()
        .iter()
        .map(TermPayload::from_local)
        .collect();

    for (key, value) in raw_settings(&db) {
        let remote_key = format!("{SETTING_PREFIX}{key}");
        if synced_setting(&key)
            && default_settings.get(&key) != Some(&value)
            && kv::get(&remote_key).is_none()
        {
            kv::set(&remote_key, &value);
        }
    }
    for term in vocabulary::get_all(&db).unwrap_or_default() {
        if !default_terms.contains(&TermPayload::from_local(&term))
            && kv::get(&term_key(&term.term)).is_none()
        {
            push_term(&term);
        }
    }
    if let Err(e) = settings::set(&db, SEEDED_KEY, "true") {
        log::warn!("iCloud: couldn't record seeding: {e}");
    }
}

/// Settings straight from SQLite, without the Keychain overlay `get_all` adds.
fn raw_settings(db: &Connection) -> HashMap<String, String> {
    let Ok(mut stmt) = db.prepare("SELECT key, value FROM settings") else {
        return HashMap::new();
    };
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

// --- NSUbiquitousKeyValueStore ---

#[cfg(target_os = "macos")]
mod kv {
    use std::ffi::{CStr, CString};

    use block::ConcreteBlock;
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    #[link(name = "Foundation", kind = "framework")]
    extern "C" {
        static NSUbiquitousKeyValueStoreDidChangeExternallyNotification: *mut Object;
        static NSUbiquitousKeyValueStoreChangedKeysKey: *mut Object;
        static NSUbiquitousKeyValueStoreChangeReasonKey: *mut Object;
    }

    /// `NSUbiquitousKeyValueStoreServerChange`: another device changed values.
    const SERVER_CHANGE: i64 = 0;

    unsafe fn store() -> *mut Object {
        msg_send![class!(NSUbiquitousKeyValueStore), defaultStore]
    }

    unsafe fn ns_string(value: &str) -> Option<*mut Object> {
        let c = CString::new(value).ok()?;
        let ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
        (!ns.is_null()).then_some(ns)
    }

    unsafe fn rust_string(ns: *mut Object) -> Option<String> {
        if ns.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![ns, UTF8String];
        (!utf8.is_null()).then(|| CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }

    unsafe fn strings(array: *mut Object) -> Vec<String> {
        if array.is_null() {
            return Vec::new();
        }
        let count: usize = msg_send![array, count];
        (0..count)
            .filter_map(|i| rust_string(msg_send![array, objectAtIndex: i]))
            .collect()
    }

    pub fn get(key: &str) -> Option<String> {
        objc::rc::autoreleasepool(|| unsafe {
            let value: *mut Object = msg_send![store(), stringForKey: ns_string(key)?];
            rust_string(value)
        })
    }

    pub fn set(key: &str, value: &str) {
        objc::rc::autoreleasepool(|| unsafe {
            if let (Some(k), Some(v)) = (ns_string(key), ns_string(value)) {
                let _: () = msg_send![store(), setString: v forKey: k];
            }
        })
    }

    pub fn remove(key: &str) {
        objc::rc::autoreleasepool(|| unsafe {
            if let Some(k) = ns_string(key) {
                let _: () = msg_send![store(), removeObjectForKey: k];
            }
        })
    }

    pub fn all_keys() -> Vec<String> {
        objc::rc::autoreleasepool(|| unsafe {
            let dict: *mut Object = msg_send![store(), dictionaryRepresentation];
            if dict.is_null() {
                return Vec::new();
            }
            strings(msg_send![dict, allKeys])
        })
    }

    pub fn synchronize() {
        unsafe {
            let _: bool = msg_send![store(), synchronize];
        }
    }

    /// Calls `on_change(changed keys, deletions allowed)` on the main thread
    /// whenever iCloud delivers values written by another Mac.
    pub fn observe_external_changes<F>(on_change: F)
    where
        F: Fn(Vec<String>, bool) + 'static,
    {
        unsafe {
            let block = ConcreteBlock::new(move |note: *mut Object| {
                let info: *mut Object = msg_send![note, userInfo];
                if info.is_null() {
                    return;
                }
                let reason: *mut Object =
                    msg_send![info, objectForKey: NSUbiquitousKeyValueStoreChangeReasonKey];
                let reason: i64 = if reason.is_null() { -1 } else { msg_send![reason, integerValue] };
                let keys = strings(msg_send![info, objectForKey: NSUbiquitousKeyValueStoreChangedKeysKey]);
                on_change(keys, reason == SERVER_CHANGE);
            })
            .copy();
            let center: *mut Object = msg_send![class!(NSNotificationCenter), defaultCenter];
            let queue: *mut Object = msg_send![class!(NSOperationQueue), mainQueue];
            let _: *mut Object = msg_send![center,
                addObserverForName: NSUbiquitousKeyValueStoreDidChangeExternallyNotification
                object: store()
                queue: queue
                usingBlock: &*block];
            // The observer lives as long as the app.
            std::mem::forget(block);
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod kv {
    pub fn get(_: &str) -> Option<String> {
        None
    }
    pub fn set(_: &str, _: &str) {}
    pub fn remove(_: &str) {}
    pub fn all_keys() -> Vec<String> {
        Vec::new()
    }
    pub fn synchronize() {}
    pub fn observe_external_changes<F: Fn(Vec<String>, bool) + 'static>(_: F) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn term_keys_fit_icloud_limit() {
        assert_eq!(term_key("  ByteCloud "), "v:bytecloud");
        let long = "ü".repeat(40);
        let key = term_key(&long);
        assert!(key.len() <= MAX_KEY_BYTES);
        assert!(key.starts_with("v:üü"));
    }
}
