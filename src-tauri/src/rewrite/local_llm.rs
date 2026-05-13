use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

use crate::error::{AppError, AppResult};

const CTX_SIZE: u32 = 4096;
const MAX_OUTPUT_TOKENS: i32 = 512;
const SAMPLER_SEED: u32 = 1234;
const SAMPLER_TEMPERATURE: f32 = 0.2;
const SAMPLER_TOP_P: f32 = 0.9;
/// Offload as many layers as possible to Metal on macOS. Values larger than
/// the actual layer count are clamped by llama.cpp.
const N_GPU_LAYERS: u32 = 99;

/// One-shot global llama.cpp backend. Initialized lazily on first use; result
/// cached so subsequent calls reuse the same backend or surface the same init
/// error.
fn backend() -> AppResult<&'static LlamaBackend> {
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| LlamaBackend::init().map_err(|e| e.to_string()))
        .as_ref()
        .map_err(|e| AppError::Config(format!("Llama backend init failed: {}", e)))
}

/// Cached local LLM. Holds the loaded model weights; a fresh context is
/// created per `rewrite` call so KV-cache state never leaks between requests.
/// Inference is serialized with a Mutex — we only ever run one rewrite at a
/// time anyway.
pub struct LocalLlmEngine {
    model: LlamaModel,
    inference_lock: Mutex<()>,
    model_path: PathBuf,
}

impl LocalLlmEngine {
    pub fn load(model_path: PathBuf) -> AppResult<Self> {
        if !model_path.exists() {
            return Err(AppError::Config(format!(
                "Local LLM model not found at {}",
                model_path.display()
            )));
        }
        let backend = backend()?;
        let model_params = LlamaModelParams::default().with_n_gpu_layers(N_GPU_LAYERS);
        let model_params = Box::pin(model_params);
        let model = LlamaModel::load_from_file(backend, &model_path, &model_params)
            .map_err(|e| AppError::Config(format!("Load local LLM model failed: {}", e)))?;
        Ok(Self {
            model,
            inference_lock: Mutex::new(()),
            model_path,
        })
    }

    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// Rewrite `user_message` according to `system_prompt`. Returns the
    /// generated assistant text, trimmed.
    pub fn rewrite(&self, system_prompt: &str, user_message: &str) -> AppResult<String> {
        let _guard = self
            .inference_lock
            .lock()
            .map_err(|_| AppError::Config("Local LLM mutex poisoned".into()))?;

        let prompt = build_llama3_prompt(system_prompt, user_message);
        let backend = backend()?;

        let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(CTX_SIZE));
        let mut ctx = self
            .model
            .new_context(backend, ctx_params)
            .map_err(|e| AppError::Config(format!("Llama context failed: {}", e)))?;

        let tokens = self
            .model
            .str_to_token(&prompt, AddBos::Always)
            .map_err(|e| AppError::Config(format!("Tokenize failed: {}", e)))?;

        // Submit the entire prompt as a single batch; only the last token
        // needs logits since that's where generation begins.
        let mut batch = LlamaBatch::new(tokens.len().max(MAX_OUTPUT_TOKENS as usize), 1);
        let last_index = (tokens.len() - 1) as i32;
        for (i, tok) in (0_i32..).zip(tokens.iter().copied()) {
            batch
                .add(tok, i, &[0], i == last_index)
                .map_err(|e| AppError::Config(format!("Batch add failed: {}", e)))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| AppError::Config(format!("Llama decode failed: {}", e)))?;

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_p(SAMPLER_TOP_P, 1),
            LlamaSampler::temp(SAMPLER_TEMPERATURE),
            LlamaSampler::dist(SAMPLER_SEED),
        ]);

        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut output = String::new();
        let mut n_cur = batch.n_tokens();
        let max_total = tokens.len() as i32 + MAX_OUTPUT_TOKENS;

        while n_cur < max_total {
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);

            if self.model.is_eog_token(token) {
                break;
            }
            let piece = self
                .model
                .token_to_piece(token, &mut decoder, false, None)
                .map_err(|e| AppError::Config(format!("token_to_piece failed: {}", e)))?;
            output.push_str(&piece);

            batch.clear();
            batch
                .add(token, n_cur, &[0], true)
                .map_err(|e| AppError::Config(format!("Batch add gen failed: {}", e)))?;
            ctx.decode(&mut batch)
                .map_err(|e| AppError::Config(format!("Llama decode gen failed: {}", e)))?;
            n_cur += 1;
        }

        Ok(output.trim().to_string())
    }
}

/// Llama 3 / 3.1 / 3.2 chat template. BOS is added by `AddBos::Always` during
/// tokenization, so we omit `<|begin_of_text|>` here.
fn build_llama3_prompt(system_prompt: &str, user_message: &str) -> String {
    format!(
        "<|start_header_id|>system<|end_header_id|>\n\n{sys}<|eot_id|>\
         <|start_header_id|>user<|end_header_id|>\n\n{usr}<|eot_id|>\
         <|start_header_id|>assistant<|end_header_id|>\n\n",
        sys = system_prompt,
        usr = user_message,
    )
}
