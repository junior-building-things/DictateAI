use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::error::{AppError, AppResult};

pub const TARGET_SAMPLE_RATE: u32 = 16000;

// Pre-roll length kept in the rolling ring buffer. On hotkey press we prepend
// this much of the most recent audio to the recording so the first syllable
// isn't lost while cpal's stream was warming up (it already is — see below).
const PREROLL_MS: u32 = 400;

/// Commands sent to the audio thread
enum AudioCommand {
    Start,
    Snapshot(mpsc::Sender<AppResult<(Vec<f32>, u32)>>),
    Stop(mpsc::Sender<AppResult<Vec<f32>>>),
}

/// Handle to control audio recording from any thread (Send + Sync safe).
/// Cloneable so multiple consumers (e.g. the streaming partial-transcript
/// task) can share access to the same audio thread.
#[derive(Clone)]
pub struct AudioCaptureHandle {
    cmd_tx: mpsc::Sender<AudioCommand>,
}

impl AudioCaptureHandle {
    /// Spawn a dedicated audio thread and return a handle
    pub fn new() -> AppResult<Self> {
        let (cmd_tx, cmd_rx) = mpsc::channel::<AudioCommand>();

        thread::spawn(move || {
            audio_thread_main(cmd_rx);
        });

        Ok(Self { cmd_tx })
    }

    pub fn start(&self) -> AppResult<()> {
        self.cmd_tx
            .send(AudioCommand::Start)
            .map_err(|_| AppError::Audio("Audio thread not running".into()))
    }

    pub fn stop(&self) -> AppResult<Vec<f32>> {
        let (result_tx, result_rx) = mpsc::channel();
        self.cmd_tx
            .send(AudioCommand::Stop(result_tx))
            .map_err(|_| AppError::Audio("Audio thread not running".into()))?;

        result_rx
            .recv()
            .map_err(|_| AppError::Audio("Audio thread did not respond".into()))?
    }

    /// Return a copy of the audio captured so far without stopping the stream.
    /// Used by the streaming partial-transcript path. Samples are returned at
    /// the device sample rate; the second tuple value is that rate.
    pub fn snapshot(&self) -> AppResult<(Vec<f32>, u32)> {
        let (result_tx, result_rx) = mpsc::channel();
        self.cmd_tx
            .send(AudioCommand::Snapshot(result_tx))
            .map_err(|_| AppError::Audio("Audio thread not running".into()))?;

        result_rx
            .recv()
            .map_err(|_| AppError::Audio("Audio thread did not respond".into()))?
    }
}

/// Shared state between the cpal callback thread and the command thread.
///
/// `ring` is always being written to at the device sample rate, capped at
/// `ring_cap` samples (~PREROLL_MS worth). `recording` holds samples since
/// the last `Start` and is only appended to when `is_recording` is true.
struct CaptureState {
    ring: VecDeque<f32>,
    ring_cap: usize,
    recording: Vec<f32>,
    is_recording: bool,
}

impl CaptureState {
    fn new(sample_rate: u32) -> Self {
        let ring_cap = (sample_rate as usize) * (PREROLL_MS as usize) / 1000;
        Self {
            ring: VecDeque::with_capacity(ring_cap),
            ring_cap,
            recording: Vec::new(),
            is_recording: false,
        }
    }

    fn push_mono(&mut self, samples: &[f32]) {
        for &s in samples {
            if self.ring.len() == self.ring_cap {
                self.ring.pop_front();
            }
            self.ring.push_back(s);
        }
        if self.is_recording {
            self.recording.extend_from_slice(samples);
        }
    }

    fn begin_recording(&mut self) {
        self.recording.clear();
        // Seed with the rolling pre-roll so the leading syllable lands in the
        // recording even though it was uttered before the keypress was handled.
        self.recording.extend(self.ring.iter().copied());
        self.is_recording = true;
    }

    fn end_recording(&mut self) -> Vec<f32> {
        self.is_recording = false;
        std::mem::take(&mut self.recording)
    }
}

/// Runs on a dedicated thread — owns the cpal stream (which is !Send on macOS).
/// The stream is opened once on first `Start` and kept alive for the rest of
/// the app's lifetime so the rolling pre-roll buffer is always primed.
#[allow(unused_assignments)]
fn audio_thread_main(cmd_rx: mpsc::Receiver<AudioCommand>) {
    let mut state: Option<Arc<Mutex<CaptureState>>> = None;
    let mut _active_stream: Option<cpal::Stream> = None;
    let mut device_sample_rate: u32 = TARGET_SAMPLE_RATE;

    for cmd in cmd_rx.iter() {
        match cmd {
            AudioCommand::Start => {
                if _active_stream.is_none() {
                    match create_input_stream() {
                        Ok((stream, sample_rate, new_state)) => {
                            device_sample_rate = sample_rate;
                            if let Err(e) = stream.play() {
                                log::error!("Failed to play stream: {}", e);
                                continue;
                            }
                            state = Some(new_state);
                            _active_stream = Some(stream);
                            log::info!(
                                "Audio stream opened (device rate: {}Hz, preroll: {}ms)",
                                sample_rate,
                                PREROLL_MS
                            );
                        }
                        Err(e) => {
                            log::error!("Failed to create input stream: {}", e);
                            continue;
                        }
                    }
                }

                if let Some(s) = state.as_ref() {
                    let mut guard = s.lock().unwrap();
                    guard.begin_recording();
                }
                log::info!("Recording started");
            }
            AudioCommand::Snapshot(result_tx) => {
                let samples = state
                    .as_ref()
                    .map(|s| s.lock().unwrap().recording.clone())
                    .unwrap_or_default();
                let _ = result_tx.send(Ok((samples, device_sample_rate)));
            }
            AudioCommand::Stop(result_tx) => {
                let samples = state
                    .as_ref()
                    .map(|s| s.lock().unwrap().end_recording())
                    .unwrap_or_default();

                log::info!(
                    "Recording stopped: {} samples at {}Hz",
                    samples.len(),
                    device_sample_rate
                );

                let result = if device_sample_rate != TARGET_SAMPLE_RATE && !samples.is_empty() {
                    match resample(&samples, device_sample_rate, TARGET_SAMPLE_RATE) {
                        Ok(resampled) => {
                            log::info!("Resampled to {} samples at 16kHz", resampled.len());
                            Ok(resampled)
                        }
                        Err(e) => Err(e),
                    }
                } else {
                    Ok(samples)
                };

                let _ = result_tx.send(result);
            }
        }
    }
}

fn create_input_stream() -> AppResult<(cpal::Stream, u32, Arc<Mutex<CaptureState>>)> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::Audio("No input device available".into()))?;

    log::info!(
        "Using input device: {}",
        device.name().unwrap_or_else(|_| "unknown".into())
    );

    let config = device
        .default_input_config()
        .map_err(|e| AppError::Audio(format!("Failed to get input config: {}", e)))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let sample_format = config.sample_format();

    log::info!(
        "Audio config: {}Hz, {} channels, format={:?}",
        sample_rate,
        channels,
        sample_format
    );

    let state = Arc::new(Mutex::new(CaptureState::new(sample_rate)));
    let err_fn = |err: cpal::StreamError| {
        log::error!("Audio stream error: {}", err);
    };

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let state_cb = Arc::clone(&state);
            device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data.iter().step_by(channels).copied().collect();
                        state_cb.lock().unwrap().push_mono(&mono);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Audio(format!("Failed to build stream: {}", e)))?
        }
        cpal::SampleFormat::I16 => {
            let state_cb = Arc::clone(&state);
            device
                .build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data
                            .iter()
                            .step_by(channels)
                            .map(|&s| s as f32 / i16::MAX as f32)
                            .collect();
                        state_cb.lock().unwrap().push_mono(&mono);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Audio(format!("Failed to build stream: {}", e)))?
        }
        format => {
            return Err(AppError::Audio(format!(
                "Unsupported sample format: {:?}",
                format
            )));
        }
    };

    Ok((stream, sample_rate, state))
}

pub fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> AppResult<Vec<f32>> {
    use rubato::{FftFixedIn, Resampler};

    let chunk_size = 1024;
    let sub_chunks = 2;
    let mut resampler = FftFixedIn::<f32>::new(
        from_rate as usize,
        to_rate as usize,
        chunk_size,
        sub_chunks,
        1,
    )
    .map_err(|e| AppError::Audio(format!("Failed to create resampler: {}", e)))?;

    let mut output = Vec::new();
    let mut pos = 0;

    while pos + chunk_size <= input.len() {
        let chunk = &input[pos..pos + chunk_size];
        let result = resampler
            .process(&[chunk], None)
            .map_err(|e| AppError::Audio(format!("Resample error: {}", e)))?;
        output.extend_from_slice(&result[0]);
        pos += chunk_size;
    }

    // Handle remaining samples by padding with zeros
    if pos < input.len() {
        let mut last_chunk = vec![0.0f32; chunk_size];
        let remaining = &input[pos..];
        last_chunk[..remaining.len()].copy_from_slice(remaining);
        let result = resampler
            .process(&[&last_chunk], None)
            .map_err(|e| AppError::Audio(format!("Resample error: {}", e)))?;
        let expected = (remaining.len() as f64 * to_rate as f64 / from_rate as f64) as usize;
        let take = expected.min(result[0].len());
        output.extend_from_slice(&result[0][..take]);
    }

    Ok(output)
}
