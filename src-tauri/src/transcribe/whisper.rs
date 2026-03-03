use std::path::Path;
use std::sync::Mutex;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::error::{AppError, AppResult};

pub struct WhisperTranscriber {
    ctx: Mutex<Option<WhisperContext>>,
    loaded_model: Mutex<Option<String>>,
}

impl WhisperTranscriber {
    pub fn new() -> Self {
        Self {
            ctx: Mutex::new(None),
            loaded_model: Mutex::new(None),
        }
    }

    pub fn load_model(&self, model_path: &Path) -> AppResult<()> {
        log::info!("Loading whisper model from {:?}", model_path);

        if !model_path.exists() {
            return Err(AppError::Transcription(format!(
                "Model file not found: {:?}",
                model_path
            )));
        }

        let ctx = WhisperContext::new_with_params(
            model_path
                .to_str()
                .ok_or_else(|| AppError::Transcription("Invalid model path".into()))?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| AppError::Transcription(format!("Failed to load model: {}", e)))?;

        let mut guard = self.ctx.lock().unwrap();
        *guard = Some(ctx);
        let mut model_guard = self.loaded_model.lock().unwrap();
        *model_guard = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|name| name.trim_start_matches("ggml-").to_string());

        log::info!("Whisper model loaded successfully");
        Ok(())
    }

    pub fn transcribe(&self, audio: &[f32], language: &str) -> AppResult<String> {
        let guard = self.ctx.lock().unwrap();
        let ctx = guard
            .as_ref()
            .ok_or_else(|| AppError::Transcription("Model not loaded".into()))?;

        // Log audio diagnostics
        let duration_secs = audio.len() as f64 / 16000.0;
        let max_amp = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let rms = (audio.iter().map(|s| s * s).sum::<f32>() / audio.len() as f32).sqrt();
        log::info!(
            "Audio stats: {:.2}s, {} samples, max_amp={:.4}, rms={:.4}",
            duration_secs,
            audio.len(),
            max_amp,
            rms
        );

        if max_amp < 0.001 {
            log::warn!("Audio appears to be silence (max amplitude < 0.001)");
            return Ok(String::new());
        }

        // Use beam search for better accuracy
        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: 1.0,
        });
        params.set_language(Some(language));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_no_context(true);
        // Allow whisper to process ALL segments
        params.set_single_segment(false);
        // Disable temperature fallback — stick with beam search
        params.set_temperature(0.0);

        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::Transcription(format!("Failed to create state: {}", e)))?;

        state
            .full(params, audio)
            .map_err(|e| AppError::Transcription(format!("Transcription failed: {}", e)))?;

        let num_segments = state.full_n_segments().map_err(|e| {
            AppError::Transcription(format!("Failed to get segment count: {}", e))
        })?;

        log::info!("Whisper produced {} segments", num_segments);

        let mut text = String::new();
        for i in 0..num_segments {
            let segment = state.full_get_segment_text(i).map_err(|e| {
                AppError::Transcription(format!("Failed to get segment {}: {}", i, e))
            })?;
            text.push_str(&segment);
        }

        let text = text.trim().to_string();
        log::info!("Transcribed: \"{}\"", text);
        Ok(text)
    }
}
