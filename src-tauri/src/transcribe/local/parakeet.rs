use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sherpa_rs::transducer::{TransducerConfig, TransducerRecognizer};

use crate::error::{AppError, AppResult};

const FEATURE_DIM: i32 = 80;
const MODEL_TYPE: &str = "nemo_transducer";
const SAMPLE_RATE: i32 = 16_000;

const FILE_ENCODER: &str = "encoder.int8.onnx";
const FILE_DECODER: &str = "decoder.int8.onnx";
const FILE_JOINER: &str = "joiner.int8.onnx";
const FILE_TOKENS: &str = "tokens.txt";

/// On-disk layout of a Parakeet model. We download into
/// `<app_data_dir>/models/parakeet/<variant>/` and expect the four files above.
pub struct ParakeetModelPaths {
    pub root: PathBuf,
}

impl ParakeetModelPaths {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn encoder(&self) -> PathBuf {
        self.root.join(FILE_ENCODER)
    }
    pub fn decoder(&self) -> PathBuf {
        self.root.join(FILE_DECODER)
    }
    pub fn joiner(&self) -> PathBuf {
        self.root.join(FILE_JOINER)
    }
    pub fn tokens(&self) -> PathBuf {
        self.root.join(FILE_TOKENS)
    }

    /// All four required files must exist for the model to be usable.
    pub fn is_complete(&self) -> bool {
        [self.encoder(), self.decoder(), self.joiner(), self.tokens()]
            .iter()
            .all(|p| p.exists())
    }
}

/// Cached recognizer. Construction loads ~300 MB of ONNX weights, so we build
/// it once and reuse across pipeline runs.
pub struct ParakeetEngine {
    inner: Mutex<TransducerRecognizer>,
    model_root: PathBuf,
}

impl ParakeetEngine {
    pub fn load(paths: &ParakeetModelPaths) -> AppResult<Self> {
        if !paths.is_complete() {
            return Err(AppError::Config(format!(
                "Parakeet model files are missing at {}. Download the model from Settings.",
                paths.root.display()
            )));
        }

        let config = TransducerConfig {
            encoder: path_string(&paths.encoder())?,
            decoder: path_string(&paths.decoder())?,
            joiner: path_string(&paths.joiner())?,
            tokens: path_string(&paths.tokens())?,
            num_threads: 1,
            sample_rate: SAMPLE_RATE,
            feature_dim: FEATURE_DIM,
            debug: false,
            model_type: MODEL_TYPE.to_string(),
            ..Default::default()
        };

        let recognizer = TransducerRecognizer::new(config).map_err(|e| {
            AppError::Config(format!("Failed to load Parakeet model: {}", e))
        })?;

        Ok(Self {
            inner: Mutex::new(recognizer),
            model_root: paths.root.clone(),
        })
    }

    /// Transcribe a complete 16 kHz mono utterance.
    ///
    /// Pre-flight validation: sherpa-onnx throws C++ exceptions when fed
    /// degenerate buffers (empty, too short, or all-NaN), and those
    /// exceptions cross the FFI boundary as `__rust_foreign_exception` —
    /// uncatchable by `std::panic::catch_unwind`, so they abort() the whole
    /// process. We catch the common degenerate cases here and return an
    /// empty string so the pipeline can short-circuit on its own logic
    /// (`raw_text.is_empty() → "Empty transcription, skipping"`) instead.
    pub fn transcribe(&self, samples: &[f32]) -> AppResult<String> {
        // 200 ms at 16 kHz. Shorter buffers don't contain enough acoustic
        // context for the transducer and tend to crash sherpa internally.
        const MIN_SAMPLES: usize = (SAMPLE_RATE as usize) / 5;
        if samples.len() < MIN_SAMPLES {
            log::warn!(
                "Parakeet input too short ({} samples < {} minimum); skipping inference",
                samples.len(),
                MIN_SAMPLES
            );
            return Ok(String::new());
        }
        if samples.iter().any(|s| !s.is_finite()) {
            log::warn!("Parakeet input contains NaN/Inf samples; skipping inference");
            return Ok(String::new());
        }

        let mut rec = self.inner.lock().map_err(|_| {
            AppError::Config("Parakeet recognizer mutex poisoned".into())
        })?;
        Ok(rec.transcribe(SAMPLE_RATE as u32, samples).trim().to_string())
    }

    pub fn model_root(&self) -> &Path {
        &self.model_root
    }
}

fn path_string(p: &Path) -> AppResult<String> {
    p.to_str()
        .map(str::to_owned)
        .ok_or_else(|| AppError::Config(format!("Non-UTF8 model path: {}", p.display())))
}
