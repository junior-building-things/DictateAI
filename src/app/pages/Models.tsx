import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AudioLines,
  Check,
  ChevronDown,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSetting,
  saveSetting,
  validateAlibabaApiKey,
  validateDeepgramApiKey,
  validateGeminiApiKey,
  validateGoogleSpeechConfig,
  validateNvidiaConfig,
  validateOpenAiApiKey,
} from "../../lib/commands";
import {
  defaultRewriteModel,
  defaultSpeechModel,
  getRewriteModelOption,
  getRewriteModelOptions,
  getSpeechModelOption,
  getSpeechModelOptions,
  type ModelMetrics,
  rewriteProviderOptions,
  speechProviderOptions,
  type RewriteProvider,
  type SpeechProvider,
} from "../../lib/modelCatalog";
import { useAppStore } from "../../lib/store";
import { cn } from "../../lib/utils";

const ALIBABA_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export const Models = () => {
  const { models, setModels } = useAppStore();
  const [deepgramKey, setDeepgramKey] = useState("");
  const [googleSpeechKey, setGoogleSpeechKey] = useState("");
  const [googleProjectId, setGoogleProjectId] = useState("");
  const [googleRegion, setGoogleRegion] = useState("us");
  const [geminiKey, setGeminiKey] = useState("");
  const [nvidiaBaseUrl, setNvidiaBaseUrl] = useState("http://127.0.0.1:9000");
  const [nvidiaApiKey, setNvidiaApiKey] = useState("");
  const [hasSavedNvidiaConfig, setHasSavedNvidiaConfig] = useState(false);
  const [alibabaKey, setAlibabaKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [action, setAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [
          nextDeepgramKey,
          nextGoogleSpeechKey,
          nextGoogleProjectId,
          nextGoogleRegion,
          nextGeminiKey,
          nextNvidiaBaseUrl,
          nextNvidiaApiKey,
          nextAlibabaKey,
          nextOpenAiKey,
        ] = await Promise.all([
          getSetting("speech_deepgram_api_key").catch(() => ""),
          getSetting("speech_google_api_key").catch(() => ""),
          getSetting("speech_google_project_id").catch(() => ""),
          getSetting("speech_google_region").catch(() => "us"),
          getSetting("gemini_api_key").catch(() => ""),
          getSetting("speech_nvidia_base_url").catch(() => "http://127.0.0.1:9000"),
          getSetting("speech_nvidia_api_key").catch(() => ""),
          getSetting("alibaba_api_key").catch(() => ""),
          getSetting("speech_openai_api_key").catch(() => ""),
        ]);

        if (!active) {
          return;
        }

        setDeepgramKey(nextDeepgramKey);
        setGoogleSpeechKey(nextGoogleSpeechKey);
        setGoogleProjectId(nextGoogleProjectId);
        setGoogleRegion(nextGoogleRegion || "us");
        setGeminiKey(nextGeminiKey);
        setNvidiaBaseUrl(nextNvidiaBaseUrl || "http://127.0.0.1:9000");
        setNvidiaApiKey(nextNvidiaApiKey);
        setAlibabaKey(nextAlibabaKey);
        setOpenAiKey(nextOpenAiKey);
      } finally {
        // nothing to clean up
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const speechOptions = getSpeechModelOptions(models.speechProvider);
  const rewriteOptions = getRewriteModelOptions(models.rewriteProvider);
  const selectedSpeechModel = getSpeechModelOption(models.speechProvider, models.speechModel);
  const selectedRewriteModel = getRewriteModelOption(models.rewriteProvider, models.rewriteModel);

  const hasConfiguredSpeechCredentials = (provider: SpeechProvider) => {
    switch (provider) {
      case "Deepgram":
        return Boolean(deepgramKey.trim());
      case "Google":
        return Boolean(googleSpeechKey.trim() && googleProjectId.trim());
      case "NVIDIA":
        return hasSavedNvidiaConfig;
      case "Alibaba":
        return Boolean(alibabaKey.trim());
    }
  };

  const hasConfiguredRewriteCredentials = (provider: RewriteProvider) => {
    switch (provider) {
      case "OpenAI":
        return Boolean(openAiKey.trim());
      case "Google":
        return Boolean(geminiKey.trim());
      case "Alibaba":
        return Boolean(alibabaKey.trim());
    }
  };

  const updateSpeechSelection = async ({
    provider = models.speechProvider,
    model = models.speechModel,
  }: {
    provider?: SpeechProvider;
    model?: string;
  }) => {
    await setModels({
      speechProvider: provider,
      speechModel: model,
    });

    if (hasConfiguredSpeechCredentials(provider)) {
      toast.info(`Speech model updated to ${model}.`);
    }
  };

  const updateRewriteSelection = async ({
    provider = models.rewriteProvider,
    model = models.rewriteModel,
  }: {
    provider?: RewriteProvider;
    model?: string;
  }) => {
    await setModels({
      rewriteProvider: provider,
      rewriteModel: model,
    });

    if (hasConfiguredRewriteCredentials(provider)) {
      toast.info(`Rewrite model updated to ${model}.`);
    }
  };

  const runAction = async (actionKey: string, work: () => Promise<void>) => {
    setAction(actionKey);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save provider settings.");
    } finally {
      setAction(null);
    }
  };

  const saveDeepgram = () =>
    runAction("save-deepgram", async () => {
      const apiKey = deepgramKey.trim();
      if (!apiKey) {
        throw new Error("Enter a Deepgram API key first.");
      }

      await validateDeepgramApiKey(apiKey);
      await saveSetting("speech_deepgram_api_key", apiKey);
      toast.info("Deepgram key validated and saved.");
    });

  const saveGoogleSpeech = () =>
    runAction("save-google-speech", async () => {
      const apiKey = googleSpeechKey.trim();
      const projectId = googleProjectId.trim();
      const region = googleRegion.trim() || "us";

      if (!apiKey) {
        throw new Error("Enter a Google Speech API key first.");
      }
      if (!projectId) {
        throw new Error("Enter a Google Cloud project ID first.");
      }

      await validateGoogleSpeechConfig(apiKey, projectId, region);
      await Promise.all([
        saveSetting("speech_google_api_key", apiKey),
        saveSetting("speech_google_project_id", projectId),
        saveSetting("speech_google_region", region),
      ]);
      setGoogleRegion(region);
      toast.info("Google speech settings validated and saved.");
    });

  const saveGemini = () =>
    runAction("save-gemini", async () => {
      const apiKey = geminiKey.trim();
      if (!apiKey) {
        throw new Error("Enter a Gemini API key first.");
      }

      await validateGeminiApiKey(apiKey, "gemini-2.5-flash-lite");
      await saveSetting("gemini_api_key", apiKey);
      toast.info("Gemini key validated and saved.");
    });

  const saveNvidia = () =>
    runAction("save-nvidia", async () => {
      const baseUrl = nvidiaBaseUrl.trim();
      const apiKey = nvidiaApiKey.trim();

      await validateNvidiaConfig(baseUrl, apiKey);
      await Promise.all([
        saveSetting("speech_nvidia_base_url", baseUrl),
        saveSetting("speech_nvidia_api_key", apiKey),
      ]);
      setNvidiaBaseUrl(baseUrl);
      setHasSavedNvidiaConfig(true);
      toast.info("NVIDIA endpoint validated and saved.");
    });

  const saveAlibaba = () =>
    runAction("save-alibaba", async () => {
      const apiKey = alibabaKey.trim();
      if (!apiKey) {
        throw new Error("Enter an Alibaba API key first.");
      }

      await validateAlibabaApiKey(apiKey);
      await Promise.all([
        saveSetting("alibaba_api_key", apiKey),
        saveSetting("alibaba_base_url", ALIBABA_BASE_URL),
      ]);
      toast.info("Alibaba key validated and saved.");
    });

  const saveOpenAi = () =>
    runAction("save-openai", async () => {
      const apiKey = openAiKey.trim();
      if (!apiKey) {
        throw new Error("Enter an OpenAI API key first.");
      }

      await validateOpenAiApiKey(apiKey);
      await saveSetting("speech_openai_api_key", apiKey);
      toast.info("OpenAI key validated and saved.");
    });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Models Configuration</h1>
        <p className="text-neutral-400">
          Choose the speech and rewrite models DictateAI uses.
        </p>
      </header>

      <section className="space-y-8 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
        <div className="flex items-center gap-3 border-b border-white/[0.06] pb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <AudioLines className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Speech Model</h2>
            <p className="text-sm text-neutral-500">
              Configure which model transcribes your speech into text.
            </p>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <Field label="Provider">
            <Select
              value={models.speechProvider}
              onChange={(value) =>
                void updateSpeechSelection({
                  provider: value as SpeechProvider,
                  model: defaultSpeechModel(value as SpeechProvider),
                })
              }
              options={speechProviderOptions}
              renderLeading={renderProviderOptionIcon}
            />
          </Field>
          <Field label="Model">
            <Select
              value={models.speechModel}
              onChange={(value) => void updateSpeechSelection({ model: value })}
              options={speechOptions.map((option) => option.label)}
            />
          </Field>
        </div>

        <MetricsRow metrics={selectedSpeechModel.metrics} firstLabel="Latency" middleLabel="Accuracy" />

        <div>
          {renderSpeechCredentials({
            provider: models.speechProvider,
            deepgramKey,
            setDeepgramKey,
            googleSpeechKey,
            setGoogleSpeechKey,
            googleProjectId,
            setGoogleProjectId,
            googleRegion,
            setGoogleRegion,
            nvidiaBaseUrl,
            setNvidiaBaseUrl: (value) => {
              setHasSavedNvidiaConfig(false);
              setNvidiaBaseUrl(value);
            },
            nvidiaApiKey,
            setNvidiaApiKey: (value) => {
              setHasSavedNvidiaConfig(false);
              setNvidiaApiKey(value);
            },
            alibabaKey,
            setAlibabaKey,
            action,
            saveDeepgram,
            saveGoogleSpeech,
            saveNvidia,
            saveAlibaba,
          })}
        </div>
      </section>

      <section className="space-y-8 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
        <div className="flex items-center gap-3 border-b border-white/[0.06] pb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <PenLine className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Rewrite Model</h2>
            <p className="text-sm text-neutral-500">
              Configure which model rewrites the transcribed text.
            </p>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <Field label="Provider">
            <Select
              value={models.rewriteProvider}
              onChange={(value) =>
                void updateRewriteSelection({
                  provider: value as RewriteProvider,
                  model: defaultRewriteModel(value as RewriteProvider),
                })
              }
              options={rewriteProviderOptions}
              renderLeading={renderProviderOptionIcon}
            />
          </Field>
          <Field label="Model">
            <Select
              value={models.rewriteModel}
              onChange={(value) => void updateRewriteSelection({ model: value })}
              options={rewriteOptions.map((option) => option.label)}
            />
          </Field>
        </div>

        <MetricsRow metrics={selectedRewriteModel.metrics} firstLabel="TFTT" middleLabel="Throughput" />

        <div>
          {renderRewriteCredentials({
            provider: models.rewriteProvider,
            openAiKey,
            setOpenAiKey,
            geminiKey,
            setGeminiKey,
            alibabaKey,
            setAlibabaKey,
            action,
            saveGemini,
            saveAlibaba,
            saveOpenAi,
          })}
        </div>
      </section>
    </div>
  );
};

const TextInput = ({
  label,
  value,
  onChange,
  placeholder,
  password = false,
  actionLabel,
  onAction,
  actionBusy = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  password?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
}) => (
  <label className="block space-y-2">
    <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
      {label}
    </span>
    <div className="relative">
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onAction && value.trim()) {
            event.preventDefault();
            onAction();
          }
        }}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
          onAction && value.trim() ? "pr-28" : "",
        )}
      />
      {onAction && value.trim() ? (
        <button
          type="button"
          onClick={onAction}
          disabled={actionBusy}
          className="absolute right-2 top-1/2 inline-flex min-w-[84px] -translate-y-1/2 items-center justify-center rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:bg-neutral-700"
        >
          {actionBusy ? "Saving..." : actionLabel ?? "Save"}
        </button>
      ) : null}
    </div>
  </label>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-3">
    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
      {label}
    </label>
    {children}
  </div>
);

const ButtonRow = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 flex flex-wrap gap-3">{children}</div>
);

const PrimaryButton = ({
  children,
  onClick,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  busy: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={busy}
    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-700"
  >
    {busy ? "Working..." : children}
  </button>
);

const MetricsRow = ({
  metrics,
  firstLabel,
  middleLabel,
}: {
  metrics: ModelMetrics;
  firstLabel: string;
  middleLabel: string;
}) => (
  <div className="flex flex-wrap items-center gap-4 pt-2">
    <MetricBadge label={firstLabel} value={metrics.latency} tone="emerald" />
    <MetricBadge label={middleLabel} value={metrics.accuracy} tone="blue" />
    <MetricBadge label="Cost" value={metrics.cost} tone="neutral" />
  </div>
);

const MetricBadge = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "blue" | "neutral";
}) => {
  const toneClasses = {
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
    neutral: "bg-white/[0.05] border-white/[0.1] text-neutral-400",
  } as const;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5",
        toneClasses[tone],
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  );
};

const Select = ({
  value,
  onChange,
  options,
  renderLeading,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  renderLeading?: (value: string) => ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white transition-all hover:bg-white/[0.05] focus:ring-1 focus:ring-blue-500/50"
      >
        <div className="flex min-w-0 items-center gap-2">
          {renderLeading ? renderLeading(value) : null}
          <span className="truncate">{value}</span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-neutral-500 transition-transform", isOpen && "rotate-180")}
        />
      </button>
      <AnimatePresence>
        {isOpen ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 4, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute left-0 top-full z-50 w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#161616] py-1 shadow-2xl"
            >
              {options.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    onChange(option);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {renderLeading ? renderLeading(option) : null}
                    <span className="truncate">{option}</span>
                  </div>
                  {value === option ? <Check className="h-4 w-4 text-blue-500" /> : null}
                </button>
              ))}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

function renderProviderOptionIcon(provider: string) {
  const assetMap: Record<string, string> = {
    Google: "/provider-icons/gemini.png",
    OpenAI: "/provider-icons/openai.png",
    Deepgram: "/provider-icons/deepgram.png",
    NVIDIA: "/provider-icons/nvidia.png",
    Alibaba: "/provider-icons/qwen.png",
  };

  const asset = assetMap[provider];
  if (asset) {
    return (
      <img
        src={asset}
        alt=""
        aria-hidden="true"
        className="h-4 w-4 rounded-[4px] object-contain"
      />
    );
  }

  return null;
}

function renderSpeechCredentials({
  provider,
  deepgramKey,
  setDeepgramKey,
  googleSpeechKey,
  setGoogleSpeechKey,
  googleProjectId,
  setGoogleProjectId,
  googleRegion,
  setGoogleRegion,
  nvidiaBaseUrl,
  setNvidiaBaseUrl,
  nvidiaApiKey,
  setNvidiaApiKey,
  alibabaKey,
  setAlibabaKey,
  action,
  saveDeepgram,
  saveGoogleSpeech,
  saveNvidia,
  saveAlibaba,
}: {
  provider: SpeechProvider;
  deepgramKey: string;
  setDeepgramKey: (value: string) => void;
  googleSpeechKey: string;
  setGoogleSpeechKey: (value: string) => void;
  googleProjectId: string;
  setGoogleProjectId: (value: string) => void;
  googleRegion: string;
  setGoogleRegion: (value: string) => void;
  nvidiaBaseUrl: string;
  setNvidiaBaseUrl: (value: string) => void;
  nvidiaApiKey: string;
  setNvidiaApiKey: (value: string) => void;
  alibabaKey: string;
  setAlibabaKey: (value: string) => void;
  action: string | null;
  saveDeepgram: () => Promise<void>;
  saveGoogleSpeech: () => Promise<void>;
  saveNvidia: () => Promise<void>;
  saveAlibaba: () => Promise<void>;
}) {
  switch (provider) {
    case "Deepgram":
      return (
        <>
          <TextInput
            label="Deepgram API Key"
            value={deepgramKey}
            onChange={setDeepgramKey}
            placeholder="dg_..."
            password
            onAction={() => void saveDeepgram()}
            actionBusy={action === "save-deepgram"}
          />
        </>
      );
    case "Google":
      return (
        <>
          <TextInput
            label="Speech API Key"
            value={googleSpeechKey}
            onChange={setGoogleSpeechKey}
            placeholder="AIza..."
            password
            onAction={() => void saveGoogleSpeech()}
            actionBusy={action === "save-google-speech"}
          />
          <TextInput
            label="Cloud Project ID"
            value={googleProjectId}
            onChange={setGoogleProjectId}
            placeholder="my-gcp-project"
          />
          <TextInput
            label="Region"
            value={googleRegion}
            onChange={setGoogleRegion}
            placeholder="us"
          />
        </>
      );
    case "NVIDIA":
      return (
        <>
          <TextInput
            label="Base URL"
            value={nvidiaBaseUrl}
            onChange={setNvidiaBaseUrl}
            placeholder="http://127.0.0.1:9000"
          />
          <TextInput
            label="API Key (optional)"
            value={nvidiaApiKey}
            onChange={setNvidiaApiKey}
            placeholder="nvapi-..."
            password
          />
          <ButtonRow>
            <PrimaryButton onClick={() => void saveNvidia()} busy={action === "save-nvidia"}>
              Save endpoint
            </PrimaryButton>
          </ButtonRow>
        </>
      );
    case "Alibaba":
      return (
        <>
          <TextInput
            label="API Key"
            value={alibabaKey}
            onChange={setAlibabaKey}
            placeholder="sk-..."
            password
            onAction={() => void saveAlibaba()}
            actionBusy={action === "save-alibaba"}
          />
        </>
      );
  }
}

function renderRewriteCredentials({
  provider,
  openAiKey,
  setOpenAiKey,
  geminiKey,
  setGeminiKey,
  alibabaKey,
  setAlibabaKey,
  action,
  saveGemini,
  saveAlibaba,
  saveOpenAi,
}: {
  provider: RewriteProvider;
  openAiKey: string;
  setOpenAiKey: (value: string) => void;
  geminiKey: string;
  setGeminiKey: (value: string) => void;
  alibabaKey: string;
  setAlibabaKey: (value: string) => void;
  action: string | null;
  saveGemini: () => Promise<void>;
  saveAlibaba: () => Promise<void>;
  saveOpenAi: () => Promise<void>;
}) {
  switch (provider) {
    case "OpenAI":
      return (
        <>
          <TextInput
            label="API Key"
            value={openAiKey}
            onChange={setOpenAiKey}
            placeholder="sk-..."
            password
            onAction={() => void saveOpenAi()}
            actionBusy={action === "save-openai"}
          />
        </>
      );
    case "Google":
      return (
        <>
          <TextInput
            label="Gemini API Key"
            value={geminiKey}
            onChange={setGeminiKey}
            placeholder="AIza..."
            password
            onAction={() => void saveGemini()}
            actionBusy={action === "save-gemini"}
          />
        </>
      );
    case "Alibaba":
      return (
        <>
          <TextInput
            label="API Key"
            value={alibabaKey}
            onChange={setAlibabaKey}
            placeholder="sk-..."
            password
            onAction={() => void saveAlibaba()}
            actionBusy={action === "save-alibaba"}
          />
        </>
      );
  }
}
