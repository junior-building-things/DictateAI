use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;

pub const STATE_IDLE: u8 = 0;
pub const STATE_RECORDING: u8 = 1;
pub const STATE_PROCESSING: u8 = 2;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub http_client: reqwest::Client,
    pub recording_state: AtomicU8,
    pub run_generation: AtomicU64,
}

impl AppState {
    pub fn new(db: Connection) -> Self {
        Self {
            db: Mutex::new(db),
            http_client: reqwest::Client::new(),
            recording_state: AtomicU8::new(STATE_IDLE),
            run_generation: AtomicU64::new(0),
        }
    }

    pub fn get_state(&self) -> u8 {
        self.recording_state.load(Ordering::Relaxed)
    }

    pub fn set_state(&self, state: u8) {
        self.recording_state.store(state, Ordering::Relaxed);
    }

    pub fn is_idle(&self) -> bool {
        self.get_state() == STATE_IDLE
    }

    pub fn is_recording(&self) -> bool {
        self.get_state() == STATE_RECORDING
    }

    pub fn begin_processing_run(&self) -> u64 {
        self.run_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn cancel_current_run(&self) {
        self.run_generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn is_run_current(&self, run_id: u64) -> bool {
        self.run_generation.load(Ordering::SeqCst) == run_id
    }
}
