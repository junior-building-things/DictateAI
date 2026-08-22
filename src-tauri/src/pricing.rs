//! Per-model cost lookups used by the Dashboard's "Cost" stat tile.
//!
//! Each call to the pipeline runs a *speech* phase and a *rewrite* phase,
//! and bills against two separate APIs. We track them together in USD,
//! summing into a single `cost_usd` column on `transcription_history`.
//!
//! Speech APIs typically bill by audio duration (Whisper $/min, Deepgram
//! $/min) — they don't expose a "tokens" concept that's meaningful to the
//! user. Rewrite APIs bill by input + output token count.
//!
//! Rates are best-effort snapshots of published pricing as of 2026-Q2.
//! Local / on-device models (Parakeet, Apple FM) bill at $0. When the user
//! switches to a model we don't have a rate for, we return $0 rather than
//! refusing to record the dictation — the rest of the pipeline still works,
//! the "Cost" tile just under-counts.

use crate::rewrite::RewriteOutcome;

/// Rewrite-phase cost for the given model + token usage.
///
/// Returns 0.0 when the model name doesn't match anything in our pricing
/// table (locally-run models, deprecated providers, "raw-transcription"
/// fallback).
pub fn rewrite_cost_usd(model: &str, outcome: &RewriteOutcome) -> f64 {
    let Some(rate) = rewrite_rate(model) else {
        return 0.0;
    };
    let prompt_dollars = (outcome.prompt_tokens as f64) * rate.per_input_token;
    let completion_dollars = (outcome.completion_tokens as f64) * rate.per_output_token;
    prompt_dollars + completion_dollars
}

/// Speech-phase cost for the given model + recorded audio length.
///
/// We bill on the actual recorded audio length in minutes rather than the
/// API's own usage echo — `duration_ms` is what we have for free, it's
/// accurate within the model's internal VAD window, and avoids a dependency
/// on each provider's response shape.
pub fn speech_cost_usd(model: &str, duration_ms: i64) -> f64 {
    let Some(per_minute) = speech_rate_per_minute(model) else {
        return 0.0;
    };
    let minutes = (duration_ms.max(0) as f64) / 60_000.0;
    minutes * per_minute
}

struct RewriteRate {
    /// USD per input (prompt) token.
    per_input_token: f64,
    /// USD per output (completion) token.
    per_output_token: f64,
}

fn rewrite_rate(model: &str) -> Option<RewriteRate> {
    // Rates expressed as `$X / 1M tokens` upstream; we divide by 1e6 at the
    // call site so the literals in this table stay readable.
    let per_million = match model {
        // ===== OpenAI =====
        "gpt-4.1-mini" => Some((0.40, 1.60)),
        "gpt-4.1-nano" => Some((0.10, 0.40)),
        "gpt-5-mini" => Some((0.25, 2.00)),
        "gpt-5-nano" => Some((0.05, 0.40)),

        // ===== Google Gemini =====
        "gemini-2.5-flash-lite" => Some((0.10, 0.40)),
        "gemini-2.5-flash" => Some((0.30, 2.50)),
        // Priced at the cheapest stable tier (2.5-flash-lite) since Google
        // hasn't published distinct rates yet for the 3.x Flash-Lite line.
        // Keep the legacy "*-preview" key too so DBs that haven't run the
        // rename migration yet still bill correctly.
        "gemini-3.1-flash-lite" | "gemini-3.1-flash-lite-preview" => Some((0.10, 0.40)),
        "gemini-3.5-flash-lite" => Some((0.30, 2.50)),
        "gemini-3.6-flash" => Some((1.50, 7.50)),
        "gemini-3-pro" | "gemini-3-pro-preview" => Some((1.25, 10.00)),

        // ===== Groq (LPU pricing) =====
        "llama-3.1-8b-instant" => Some((0.05, 0.08)),
        "llama-3.3-70b-versatile" => Some((0.59, 0.79)),
        "openai/gpt-oss-20b" => Some((0.10, 0.50)),
        "openai/gpt-oss-120b" => Some((0.15, 0.75)),
        "moonshotai/kimi-k2-instruct-0905" => Some((1.00, 3.00)),

        // ===== Alibaba (DashScope, paid-tier USD equivalents) =====
        "qwen-flash" => Some((0.05, 0.20)),
        "qwen-plus" => Some((0.40, 1.20)),
        "qwen-max" => Some((1.60, 6.40)),

        _ => None,
    }?;
    Some(RewriteRate {
        per_input_token: per_million.0 / 1_000_000.0,
        per_output_token: per_million.1 / 1_000_000.0,
    })
}

fn speech_rate_per_minute(model: &str) -> Option<f64> {
    match model {
        // OpenAI Whisper + GPT-4o transcribe family — billed per minute.
        "whisper-1" => Some(0.006),
        "gpt-4o-transcribe" => Some(0.006),
        "gpt-4o-mini-transcribe" => Some(0.003),

        // Groq Whisper — billed per hour upstream, normalize to per minute.
        "whisper-large-v3" => Some(0.111 / 60.0),
        "whisper-large-v3-turbo" => Some(0.04 / 60.0),

        // Deepgram Nova-3 prerecorded.
        "nova-3" => Some(0.0077),

        // Alibaba Qwen3-ASR.
        "qwen3-asr-flash" => Some(0.0021),

        // Local models — on-device, no API spend.
        "parakeet-tdt-0.6b-v2-int8" | "parakeet-tdt-0.6b-v3-int8" => Some(0.0),

        _ => None,
    }
}
