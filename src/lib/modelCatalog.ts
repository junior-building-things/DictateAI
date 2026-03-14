export type SpeechProvider = "Deepgram" | "Google" | "NVIDIA" | "Alibaba";
export type RewriteProvider = "OpenAI" | "Google" | "Alibaba";

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

export const DEFAULT_SPEECH_PROVIDER: SpeechProvider = "Deepgram";
export const DEFAULT_REWRITE_PROVIDER: RewriteProvider = "Google";

const speechCatalog: Record<SpeechProvider, ModelOption[]> = {
  Deepgram: [
    {
      label: "Nova-3",
      setting: "deepgram-nova-3",
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
      label: "Chirp 3",
      setting: "google-chirp-3",
      description: "Google Cloud Speech-to-Text v2 Chirp 3.",
      metrics: {
        latency: "300-600 ms",
        accuracy: "4-6% WER",
        cost: "$0.016/min",
      },
    },
  ],
  NVIDIA: [
    {
      label: "Parakeet TDT 0.6B v2",
      setting: "nvidia-parakeet-tdt-0.6b-v2",
      description: "Use with an NVIDIA NIM-compatible ASR endpoint for Parakeet.",
      metrics: {
        latency: "150-250 ms",
        accuracy: "6-9% WER",
        cost: "Free",
      },
    },
    {
      label: "Canary Qwen 2.5B",
      setting: "nvidia-canary-qwen-2.5b",
      description: "Use with an NVIDIA-compatible ASR endpoint for Canary Qwen.",
      metrics: {
        latency: "200-400 ms",
        accuracy: "5-7% WER",
        cost: "Free",
      },
    },
  ],
  Alibaba: [
    {
      label: "Qwen3 ASR Flash",
      setting: "alibaba-qwen3-asr-flash",
      description: "Alibaba Model Studio ASR through the OpenAI-compatible chat endpoint.",
      metrics: {
        latency: "90-120 ms TTFT",
        accuracy: "3-6% WER",
        cost: "$0.0021/min",
      },
    },
  ],
};

const rewriteCatalog: Record<RewriteProvider, ModelOption[]> = {
  OpenAI: [
    {
      label: "GPT-4.1 Mini",
      setting: "gpt-4.1-mini",
      description: "OpenAI's lower-latency GPT-4.1 rewrite model.",
      metrics: {
        latency: "700-1100 ms",
        accuracy: "74 tokens/s",
        cost: "$0.000224",
      },
    },
    {
      label: "GPT-4.1 Nano",
      setting: "gpt-4.1-nano",
      description: "The lightest GPT-4.1 rewrite option.",
      metrics: {
        latency: "600-900 ms",
        accuracy: "127 tokens/s",
        cost: "$0.000056",
      },
    },
  ],
  Google: [
    {
      label: "Gemini 2.5 Flash Lite",
      setting: "gemini-2.5-flash-lite",
      description: "Fast prompt-aware rewrite with Gemini 2.5 Flash-Lite.",
      metrics: {
        latency: "300-800 ms",
        accuracy: "184-392 tokens/s",
        cost: "$0.000056",
      },
    },
    {
      label: "Gemini 3.1 Flash Lite",
      setting: "gemini-3.1-flash-lite-preview",
      description: "Maps to Google's public Gemini 3.1 Flash-Lite preview model.",
      metrics: {
        latency: "100-300 ms",
        accuracy: "Faster output (45% faster)",
        cost: "$0.000173",
      },
    },
  ],
  Alibaba: [
    {
      label: "Qwen2.5 7B Instruct",
      setting: "qwen2.5-7b-instruct",
      description: "Alibaba's compact instruction-tuned Qwen 2.5 model.",
      metrics: {
        latency: "0.5-1.5 s typical (depends on GPU)",
        accuracy: "60-120 tokens/s",
        cost: "Free",
      },
    },
    {
      label: "Qwen3 8B",
      setting: "qwen3-8b",
      description: "Alibaba's Qwen3 8B chat model with thinking disabled for speed.",
      metrics: {
        latency: "Not published",
        accuracy: "Not published",
        cost: "$0.072/$0.287",
      },
    },
  ],
};

const legacySpeechAliases: Record<string, string> = {
  "gpt-4o-mini-transcribe": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "gpt-4o-transcribe": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "Local On-Device Speech": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
  "doubao-byteplus": firstSpeechSetting(DEFAULT_SPEECH_PROVIDER),
};

const legacyRewriteAliases: Record<string, string> = {
  "gpt-4o-mini": "gpt-4.1-mini",
  "gpt-4.1": "gpt-4.1-mini",
  "Rule-based Cleanup": firstRewriteSetting(DEFAULT_REWRITE_PROVIDER),
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
