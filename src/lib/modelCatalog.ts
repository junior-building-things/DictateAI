export type SpeechProvider = "Deepgram" | "Google" | "OpenAI" | "Alibaba" | "Local";
export type RewriteProvider = "OpenAI" | "Google" | "Alibaba" | "Local";

/// Local-engine model IDs that pair with the "Local" provider above.
/// Kept in sync with the Rust-side `LocalModelSpec.id` constants.
export const PARAKEET_V2_LOCAL_MODEL_ID = "parakeet-tdt-0.6b-v2-int8";
export const PARAKEET_V3_LOCAL_MODEL_ID = "parakeet-tdt-0.6b-v3-int8";
/// Back-compat alias — earlier code imported this constant for the v2 model.
export const PARAKEET_LOCAL_MODEL_ID = PARAKEET_V2_LOCAL_MODEL_ID;
export const LLAMA_LOCAL_MODEL_ID = "llama-3.2-1b-instruct-q4km";
export const GEMMA_LOCAL_MODEL_ID = "gemma-3-1b-it-q4km";

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

export const DEFAULT_SPEECH_PROVIDER: SpeechProvider = "OpenAI";
export const DEFAULT_REWRITE_PROVIDER: RewriteProvider = "Google";

const speechCatalog: Record<SpeechProvider, ModelOption[]> = {
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
  Google: [
    {
      label: "chirp_3",
      setting: "chirp_3",
      description: "Google Cloud Speech-to-Text v2 Chirp 3.",
      metrics: {
        latency: "300-600 ms",
        accuracy: "4-6% WER",
        cost: "$0.016/min",
      },
    },
  ],
  OpenAI: [
    {
      label: "gpt-4o-mini-transcribe",
      setting: "gpt-4o-mini-transcribe",
      description: "Lighter, faster OpenAI GPT-4o Mini speech-to-text.",
      metrics: {
        latency: "300-600 ms",
        accuracy: "5-7% WER",
        cost: "$0.003/min",
      },
    },
    {
      label: "gpt-4o-transcribe",
      setting: "gpt-4o-transcribe",
      description: "OpenAI GPT-4o powered speech-to-text transcription.",
      metrics: {
        latency: "500-900 ms",
        accuracy: "3-5% WER",
        cost: "$0.006/min",
      },
    },
  ],
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
  Local: [
    {
      label: "parakeet-tdt-0.6b-v2-int8",
      setting: "parakeet-tdt-0.6b-v2-int8",
      description:
        "On-device NVIDIA Parakeet TDT 0.6B v2 (int8) via sherpa-onnx. Runs offline with Metal acceleration on Apple Silicon.",
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
};

const rewriteCatalog: Record<RewriteProvider, ModelOption[]> = {
  OpenAI: [
    {
      label: "gpt-5-mini",
      setting: "gpt-5-mini",
      description: "OpenAI's smaller GPT-5 rewrite model.",
      metrics: {
        latency: "700-1100 ms",
        accuracy: "74 tokens/s",
        cost: "$0.000224/req",
      },
    },
    {
      label: "gpt-5-nano",
      setting: "gpt-5-nano",
      description: "The lightest GPT-5 rewrite option.",
      metrics: {
        latency: "600-900 ms",
        accuracy: "127 tokens/s",
        cost: "$0.000056/req",
      },
    },
  ],
  Google: [
    {
      label: "gemini-2.5-flash-lite",
      setting: "gemini-2.5-flash-lite",
      description: "Fast prompt-aware rewrite with Gemini 2.5 Flash-Lite.",
      metrics: {
        latency: "300-800 ms",
        accuracy: "184-392 tokens/s",
        cost: "$0.000056/req",
      },
    },
    {
      label: "gemini-3.1-flash-lite-preview",
      setting: "gemini-3.1-flash-lite-preview",
      description: "Maps to Google's public Gemini 3.1 Flash-Lite preview model.",
      metrics: {
        latency: "100-300 ms",
        accuracy: "Faster output (45% faster)",
        cost: "$0.000173/req",
      },
    },
  ],
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
  Local: [
    {
      label: "llama-3.2-1b-instruct-q4km",
      setting: "llama-3.2-1b-instruct-q4km",
      description:
        "Llama 3.2 1B Instruct (Q4_K_M) via llama.cpp with Metal acceleration. Runs offline.",
      metrics: {
        latency: "300-700 ms",
        accuracy: "100-200 tokens/s",
        cost: "Free (on-device)",
      },
    },
    {
      label: "gemma-3-1b-it-q4km",
      setting: "gemma-3-1b-it-q4km",
      description:
        "Google Gemma 3 1B IT (Q4_K_M) via llama.cpp with Metal acceleration. Runs offline.",
      metrics: {
        latency: "300-700 ms",
        accuracy: "100-200 tokens/s",
        cost: "Free (on-device)",
      },
    },
  ],
};

const legacySpeechAliases: Record<string, string> = {
  "deepgram-nova-3": "nova-3",
  "google-chirp-3": "chirp_3",
  "alibaba-qwen3-asr-flash": "qwen3-asr-flash",
  "nvidia-parakeet-tdt-0.6b-v2": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "nvidia-canary-qwen-2.5b": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "Local On-Device Speech": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "doubao-byteplus": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  // Earlier rollout shipped a placeholder setting — migrate to the v2 spec id.
  "parakeet-local": "parakeet-tdt-0.6b-v2-int8",
};

const legacyRewriteAliases: Record<string, string> = {
  "gpt-4o-mini": "gpt-5-mini",
  "gpt-4.1": "gpt-5-mini",
  "gpt-4.1-mini": "gpt-5-mini",
  "gpt-4.1-nano": "gpt-5-nano",
  "qwen3-8b": "qwen2.5-7b-instruct",
  "Rule-based Cleanup": firstRewriteSetting(DEFAULT_REWRITE_PROVIDER),
  // Initial local-LLM rollout shipped a placeholder setting value;
  // migrate it to the explicit Llama spec id.
  "local-llm": "llama-3.2-1b-instruct-q4km",
};

export const speechProviderOptions = Object.keys(speechCatalog) as SpeechProvider[];
export const rewriteProviderOptions = Object.keys(rewriteCatalog) as RewriteProvider[];

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
