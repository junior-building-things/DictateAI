export type SpeechProvider = "Alibaba" | "Deepgram" | "Groq" | "NVIDIA" | "OpenAI";
export type RewriteProvider = "Alibaba" | "Apple" | "Google" | "Groq" | "OpenAI";

/// Local-engine model IDs that pair with the on-device providers (NVIDIA for
/// speech, Apple for rewrite). Kept in sync with the Rust-side
/// `LocalModelSpec.id` constants and the `apple-fm-system` rewrite tag.
export const PARAKEET_V2_LOCAL_MODEL_ID = "parakeet-tdt-0.6b-v2-int8";
export const PARAKEET_V3_LOCAL_MODEL_ID = "parakeet-tdt-0.6b-v3-int8";
/// Back-compat alias — earlier code imported this constant for the v2 model.
export const PARAKEET_LOCAL_MODEL_ID = PARAKEET_V2_LOCAL_MODEL_ID;
export const APPLE_FM_REWRITE_ID = "apple-fm-system";

export interface ModelOption {
  label: string;
  setting: string;
  description: string;
  metrics: ModelMetrics;
}

export interface ModelMetrics {
  latency: string;
  accuracy: string;
  cost: string;
}

export const DEFAULT_SPEECH_PROVIDER: SpeechProvider = "Groq";
export const DEFAULT_REWRITE_PROVIDER: RewriteProvider = "Google";

const speechCatalog: Record<SpeechProvider, ModelOption[]> = {
  Alibaba: [
    {
      label: "qwen3-asr-flash",
      setting: "qwen3-asr-flash",
      description: "Alibaba Model Studio ASR through the OpenAI-compatible chat endpoint.",
      metrics: {
        latency: "90-120 ms TTFT",
        accuracy: "3-6% WER",
        cost: "$0.0021/min",
      },
    },
  ],
  Deepgram: [
    {
      label: "nova-3",
      setting: "nova-3",
      description: "Deepgram's general-purpose streaming and prerecorded speech model.",
      metrics: {
        latency: "200-300 ms",
        accuracy: "5-7% WER",
        cost: "$0.0077/min",
      },
    },
  ],
  Groq: [
    {
      label: "whisper-large-v3",
      setting: "whisper-large-v3",
      description:
        "OpenAI Whisper Large v3 served on Groq's LPU infrastructure for near-real-time latency.",
      metrics: {
        latency: "200-400 ms",
        accuracy: "4-6% WER",
        cost: "$0.111/hr",
      },
    },
    {
      label: "whisper-large-v3-turbo",
      setting: "whisper-large-v3-turbo",
      description:
        "Distilled Whisper Large v3 Turbo on Groq. Roughly 2-3x faster than v3 with a small accuracy trade-off.",
      metrics: {
        latency: "100-200 ms",
        accuracy: "5-7% WER",
        cost: "$0.04/hr",
      },
    },
  ],
  NVIDIA: [
    {
      label: "parakeet-tdt-0.6b-v2-int8",
      setting: "parakeet-tdt-0.6b-v2-int8",
      description:
        "On-device NVIDIA Parakeet TDT 0.6B v2 (int8) via sherpa-onnx. Runs offline on the CPU. English only.",
      metrics: {
        latency: "100-300 ms",
        accuracy: "5-7% WER",
        cost: "Free (on-device)",
      },
    },
    {
      label: "parakeet-tdt-0.6b-v3-int8",
      setting: "parakeet-tdt-0.6b-v3-int8",
      description:
        "On-device NVIDIA Parakeet TDT 0.6B v3 (int8). Refresh of v2 with improved accuracy and multilingual support.",
      metrics: {
        latency: "100-300 ms",
        accuracy: "4-6% WER",
        cost: "Free (on-device)",
      },
    },
  ],
  OpenAI: [
    {
      label: "gpt-transcribe",
      setting: "gpt-transcribe",
      description:
        "OpenAI GPT-Transcribe — replaced gpt-4o-transcribe, with a lower error rate and keyword hints.",
      metrics: {
        latency: "Medium",
        accuracy: "Lower WER than gpt-4o-transcribe",
        cost: "$0.0045/min",
      },
    },
  ],
};

const rewriteCatalog: Record<RewriteProvider, ModelOption[]> = {
  Alibaba: [
    {
      label: "qwen2.5-7b-instruct",
      setting: "qwen2.5-7b-instruct",
      description: "Alibaba's compact instruction-tuned Qwen 2.5 model.",
      metrics: {
        latency: "0.5-1.5 s typical (depends on GPU)",
        accuracy: "60-120 tokens/s",
        cost: "$0.0000105/req",
      },
    },
  ],
  Apple: [
    {
      label: "apple-fm-system",
      setting: "apple-fm-system",
      description:
        "Apple's on-device foundation model (macOS 26+). Runs on the Neural Engine via the FoundationModels framework — no model download, no cold start.",
      metrics: {
        latency: "200-500 ms",
        accuracy: "Always-resident",
        cost: "Free (on-device)",
      },
    },
  ],
  Google: [
    {
      label: "gemini-3.5-flash-lite",
      setting: "gemini-3.5-flash-lite",
      description: "Google's Gemini 3.5 Flash-Lite — the default rewrite model.",
      metrics: {
        latency: "200-400 ms",
        accuracy: "1M context, 64K output",
        cost: "$0.00025/req",
      },
    },
    {
      label: "gemini-3.6-flash",
      setting: "gemini-3.6-flash",
      description:
        "Google's Gemini 3.6 Flash — the full Flash tier. Better on hard cleanups than Flash-Lite, but ~10x the cost per rewrite.",
      metrics: {
        latency: "400-900 ms",
        accuracy: "1M context, 64K output",
        cost: "$0.00094/req",
      },
    },
  ],
  Groq: [
    {
      label: "gpt-oss-20b",
      setting: "openai/gpt-oss-20b",
      description:
        "OpenAI's open-weight GPT-OSS 20B on Groq's LPU silicon, run with low reasoning effort. The fastest Groq option.",
      metrics: {
        latency: "Very fast",
        accuracy: "~1000 tokens/s",
        cost: "$0.00008/req",
      },
    },
    {
      label: "gpt-oss-120b",
      setting: "openai/gpt-oss-120b",
      description:
        "GPT-OSS 120B on Groq. Slower than 20B but better on hard cleanups (self-correction, garbled-word fixes).",
      metrics: {
        latency: "Fast",
        accuracy: "~500 tokens/s",
        cost: "$0.00016/req",
      },
    },
  ],
  OpenAI: [
    {
      label: "gpt-6-luna",
      setting: "gpt-6-luna",
      description: "OpenAI's most efficient GPT-6 model, run with reasoning off.",
      metrics: {
        latency: "Fast",
        accuracy: "1M context",
        cost: "$0.00007/req",
      },
    },
    {
      label: "gpt-6.1-terra",
      setting: "gpt-6.1-terra",
      description: "OpenAI's fast mid-tier GPT-6.1 model, run with reasoning off. Better writing, ~10x the cost of Luna.",
      metrics: {
        latency: "Medium",
        accuracy: "1M context",
        cost: "$0.0007/req",
      },
    },
  ],
};

const legacySpeechAliases: Record<string, string> = {
  "deepgram-nova-3": "nova-3",
  "google-chirp-3": "chirp_3",
  // OpenAI shut these down on 2027-02-26.
  "gpt-4o-transcribe": "gpt-transcribe",
  "gpt-4o-mini-transcribe": "gpt-transcribe",
  "alibaba-qwen3-asr-flash": "qwen3-asr-flash",
  "nvidia-parakeet-tdt-0.6b-v2": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "nvidia-canary-qwen-2.5b": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "Local On-Device Speech": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "doubao-byteplus": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  // Earlier rollout shipped a placeholder setting — migrate to the v2 spec id.
  "parakeet-local": "parakeet-tdt-0.6b-v2-int8",
};

const legacyRewriteAliases: Record<string, string> = {
  "gpt-4o-mini": "gpt-6.1-terra",
  "gpt-4.1": "gpt-6.1-terra",
  "gpt-4.1-mini": "gpt-6.1-terra",
  "gpt-4.1-nano": "gpt-6-luna",
  // Retired or restricted upstream; mirrors the migrations in schema.rs.
  "gpt-5-mini": "gpt-6.1-terra",
  "gpt-5-nano": "gpt-6-luna",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite-preview": "gemini-3.5-flash-lite",
  "qwen3-8b": "qwen2.5-7b-instruct",
  "Rule-based Cleanup": firstRewriteSetting(DEFAULT_REWRITE_PROVIDER),
  // Initial local-LLM rollout shipped a placeholder setting value;
  // migrate it to Apple FM (closest in-spirit replacement now that the
  // bundled Llama / Gemma 1B GGUFs have been removed from the catalog).
  "local-llm": APPLE_FM_REWRITE_ID,
  "llama-3.2-1b-instruct-q4km": APPLE_FM_REWRITE_ID,
  "gemma-3-1b-it-q4km": APPLE_FM_REWRITE_ID,
};

/// The `thinkingLevel` values Gemini 3.x accepts, cheapest first. Kept in
/// sync with `normalize_thinking_level` in `src-tauri/src/rewrite/gemini.rs`.
export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/// Only Gemini 3.x takes a thinking level; no other rewrite provider here
/// has an equivalent.
/// Mirrors the `thinking_config` match arms in `rewrite/gemini.rs`.
export function rewriteModelSupportsThinking(setting: string) {
  return setting.startsWith("gemini-3");
}

export const speechProviderOptions = (Object.keys(speechCatalog) as SpeechProvider[]).sort();
export const rewriteProviderOptions = (Object.keys(rewriteCatalog) as RewriteProvider[]).sort();

export function getSpeechModelOptions(provider: SpeechProvider) {
  return speechCatalog[provider];
}

export function getRewriteModelOptions(provider: RewriteProvider) {
  return rewriteCatalog[provider];
}

export function getSpeechModelOption(
  provider: SpeechProvider,
  value: string,
) {
  return getSpeechModelOptions(provider).find((option) => option.label === value)
    ?? getSpeechModelOptions(provider)[0];
}

export function getRewriteModelOption(
  provider: RewriteProvider,
  value: string,
) {
  return getRewriteModelOptions(provider).find((option) => option.label === value)
    ?? getRewriteModelOptions(provider)[0];
}

export function defaultSpeechModel(provider: SpeechProvider = DEFAULT_SPEECH_PROVIDER) {
  return getSpeechModelOptions(provider)[0].label;
}

export function defaultRewriteModel(provider: RewriteProvider = DEFAULT_REWRITE_PROVIDER) {
  return getRewriteModelOptions(provider)[0].label;
}

export function normalizeSpeechProvider(
  storedProvider: string | undefined,
  storedModel: string | undefined,
): SpeechProvider {
  if (isSpeechProvider(storedProvider)) {
    return storedProvider;
  }

  return speechProviderForSetting(normalizeSpeechSetting(storedModel)) ?? DEFAULT_SPEECH_PROVIDER;
}

export function normalizeRewriteProvider(
  storedProvider: string | undefined,
  storedModel: string | undefined,
): RewriteProvider {
  if (isRewriteProvider(storedProvider)) {
    return storedProvider;
  }

  return rewriteProviderForSetting(normalizeRewriteSetting(storedModel)) ?? DEFAULT_REWRITE_PROVIDER;
}

export function speechModelSettingToLabel(
  provider: SpeechProvider,
  value: string | undefined,
) {
  return getSpeechModelOptions(provider).find((option) => option.setting === normalizeSpeechSetting(value))
    ?.label ?? defaultSpeechModel(provider);
}

export function rewriteModelSettingToLabel(
  provider: RewriteProvider,
  value: string | undefined,
) {
  return getRewriteModelOptions(provider).find((option) => option.setting === normalizeRewriteSetting(value))
    ?.label ?? defaultRewriteModel(provider);
}

export function speechModelLabelToSetting(
  provider: SpeechProvider,
  value: string,
) {
  return getSpeechModelOptions(provider).find((option) => option.label === value)?.setting
    ?? firstSpeechSetting(provider);
}

export function rewriteModelLabelToSetting(
  provider: RewriteProvider,
  value: string,
) {
  return getRewriteModelOptions(provider).find((option) => option.label === value)?.setting
    ?? firstRewriteSetting(provider);
}

function speechProviderForSetting(value: string | undefined) {
  return speechProviderOptions.find((provider) =>
    getSpeechModelOptions(provider).some((option) => option.setting === value)
  );
}

function rewriteProviderForSetting(value: string | undefined) {
  return rewriteProviderOptions.find((provider) =>
    getRewriteModelOptions(provider).some((option) => option.setting === value)
  );
}

function normalizeSpeechSetting(value: string | undefined) {
  if (!value) {
    return firstSpeechSetting(DEFAULT_SPEECH_PROVIDER);
  }

  return legacySpeechAliases[value] ?? value;
}

function normalizeRewriteSetting(value: string | undefined) {
  if (!value) {
    return firstRewriteSetting(DEFAULT_REWRITE_PROVIDER);
  }

  return legacyRewriteAliases[value] ?? value;
}

function firstSpeechSetting(provider: SpeechProvider) {
  return getSpeechModelOptions(provider)[0].setting;
}

function firstRewriteSetting(provider: RewriteProvider) {
  return getRewriteModelOptions(provider)[0].setting;
}

function isSpeechProvider(value: string | undefined): value is SpeechProvider {
  return speechProviderOptions.includes(value as SpeechProvider);
}

function isRewriteProvider(value: string | undefined): value is RewriteProvider {
  return rewriteProviderOptions.includes(value as RewriteProvider);
}
