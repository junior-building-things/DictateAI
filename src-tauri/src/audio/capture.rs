use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::error::{AppError, AppResult};

const TARGET_SAMPLE_RATE: u32 = 16000;

/// Commands sent to the audio thread
enum AudioCommand {
    Start,
    Stop(mpsc::Sender<AppResult<Vec<f32>>>),
}

/// Handle to control audio recording from any thread (Send + Sync safe)
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
}

/// Runs on a dedicated thread — owns the cpal stream (which is !Send on macOS)
#[allow(unused_assignments)]
fn audio_thread_main(cmd_rx: mpsc::Receiver<AudioCommand>) {
    let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    // We use an Option to hold the stream while recording
    let mut _active_stream: Option<cpal::Stream> = None;
    let mut device_sample_rate: u32 = TARGET_SAMPLE_RATE;

    for cmd in cmd_rx.iter() {
        match cmd {
            AudioCommand::Start => {
                // Clear buffer
                {
                    let mut buf = buffer.lock().unwrap();
                    buf.clear();
                }

                match create_input_stream(&buffer) {
                    Ok((stream, sample_rate)) => {
                        device_sample_rate = sample_rate;
                        if let Err(e) = stream.play() {
                            log::error!("Failed to play stream: {}", e);
                            continue;
                        }
                        _active_stream = Some(stream);
                        log::info!("Recording started (device rate: {}Hz)", sample_rate);
                    }
                    Err(e) => {
                        log::error!("Failed to create input stream: {}", e);
                    }
                }
            }
            AudioCommand::Stop(result_tx) => {
                // Drop the stream to stop recording
                _active_stream = None;

                let samples = {
                    let mut buf = buffer.lock().unwrap();
                    std::mem::take(&mut *buf)
                };

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

fn create_input_stream(buffer: &Arc<Mutex<Vec<f32>>>) -> AppResult<(cpal::Stream, u32)> {
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

    let buffer_clone = Arc::clone(buffer);
    let err_fn = |err: cpal::StreamError| {
        log::error!("Audio stream error: {}", err);
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mono: Vec<f32> = data.iter().step_by(channels).copied().collect();
                    let mut buf = buffer_clone.lock().unwrap();
                    buf.extend_from_slice(&mono);
                },
                err_fn,
                None,
            )
            .map_err(|e| AppError::Audio(format!("Failed to build stream: {}", e)))?,
        cpal::SampleFormat::I16 => {
            let buffer_clone = Arc::clone(buffer);
            device
                .build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let mono: Vec<f32> = data
                            .iter()
                            .step_by(channels)
                            .map(|&s| s as f32 / i16::MAX as f32)
                            .collect();
                        let mut buf = buffer_clone.lock().unwrap();
                        buf.extend_from_slice(&mono);
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

    Ok((stream, sample_rate))
}

fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> AppResult<Vec<f32>> {
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
