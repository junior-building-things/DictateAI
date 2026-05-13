use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::audio::capture::{resample, AudioCaptureHandle, TARGET_SAMPLE_RATE};
use crate::transcribe::local::parakeet::ParakeetEngine;

/// How often to wake and consider a partial inference.
const TICK: Duration = Duration::from_millis(300);
/// Skip inference unless the buffer has grown by at least this many samples
/// since the last partial — avoids wasting cycles re-running on identical
/// audio between ticks.
const MIN_NEW_SAMPLES: usize = TARGET_SAMPLE_RATE as usize / 2; // 0.5 s
/// Don't bother running partials until we have at least this much audio. The
/// model needs a bit of signal to produce useful output.
const MIN_TOTAL_SAMPLES: usize = TARGET_SAMPLE_RATE as usize; // 1 s

/// Cancellable handle to an in-flight streaming task. Drop or call `stop` to
/// signal the task to exit; the task itself will finish its current inference
/// before honoring the signal.
pub struct StreamingHandle {
    cancel: Arc<AtomicBool>,
}

impl StreamingHandle {
    pub fn stop(&self) {
        self.cancel.store(true, Ordering::Release);
    }
}

/// Spawn a background task that periodically transcribes the audio captured so
/// far and emits `transcription-partial` events with the latest text. Returns
/// a cancel handle.
pub fn start(
    app: AppHandle,
    capture: AudioCaptureHandle,
    engine: Arc<ParakeetEngine>,
) -> StreamingHandle {
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = Arc::clone(&cancel);

    tauri::async_runtime::spawn(async move {
        let mut last_text = String::new();
        let mut last_inference_at = Instant::now() - TICK;
        let mut last_inference_samples: usize = 0;

        loop {
            tokio::time::sleep(TICK).await;
            if cancel_clone.load(Ordering::Acquire) {
                break;
            }

            let (samples, device_rate) = match capture.snapshot() {
                Ok(s) => s,
                Err(e) => {
                    log::debug!("streaming snapshot failed: {}", e);
                    continue;
                }
            };

            if samples.len() < MIN_TOTAL_SAMPLES {
                continue;
            }
            if samples.len().saturating_sub(last_inference_samples) < MIN_NEW_SAMPLES {
                continue;
            }
            // Throttle: don't fire faster than every TICK regardless of how
            // long the previous inference took.
            if last_inference_at.elapsed() < TICK {
                continue;
            }

            let prepared = if device_rate == TARGET_SAMPLE_RATE {
                samples
            } else {
                match resample(&samples, device_rate, TARGET_SAMPLE_RATE) {
                    Ok(r) => r,
                    Err(e) => {
                        log::debug!("streaming resample failed: {}", e);
                        continue;
                    }
                }
            };

            let new_samples_len = prepared.len();
            let engine_for_task = Arc::clone(&engine);
            let inference =
                tokio::task::spawn_blocking(move || engine_for_task.transcribe(&prepared)).await;

            if cancel_clone.load(Ordering::Acquire) {
                break;
            }

            last_inference_at = Instant::now();
            last_inference_samples = new_samples_len;

            let text = match inference {
                Ok(Ok(t)) => t,
                Ok(Err(e)) => {
                    log::debug!("streaming inference error: {}", e);
                    continue;
                }
                Err(join) => {
                    log::debug!("streaming task join error: {}", join);
                    continue;
                }
            };

            if text != last_text && !text.is_empty() {
                last_text.clone_from(&text);
                let _ = app.emit("transcription-partial", &text);
            }
        }

        log::debug!("streaming task exited");
    });

    StreamingHandle { cancel }
}
