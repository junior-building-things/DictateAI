import { useEffect, useState, type ReactNode } from "react";
import { Apple, AudioLines, FileArchive, KeyRound, Loader2, PenLine, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Dropdown, ProviderLogo } from "../../components/Dropdown";
import {
  appleFmAvailability,
  type AppleFmAvailability,
  getSetting,
  saveSetting,
  validateAlibabaApiKey,
  validateDeepgramApiKey,
  validateGeminiApiKey,
  validateGoogleSpeechConfig,
  validateGroqApiKey,
  validateOpenAiApiKey,
} from "../../lib/commands";
import {
  defaultRewriteModel,
  defaultSpeechModel,
  getRewriteModelOptions,
  getSpeechModelOptions,
  rewriteProviderOptions,
  speechProviderOptions,
  type RewriteProvider,
  type SpeechProvider,
} from "../../lib/modelCatalog";
import LocalModelCard from "../../components/LocalModelCard";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";

const ALIBABA_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const SETTINGS_CHANGED_EVENT = "dictateai-settings-changed";

function emitSettingsChanged() {
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

/**
 * Settings → Models. Matches the design file's `models:` panel:
 *   Group "Speech":  model dropdown row + per-provider key row.
 *   Group "Rewrite": model dropdown row + per-provider key row.
 *
 * Model dropdowns show a colored provider logo on the left and
 * "Provider — model" as the label. Key rows render either an
 * API-key input + Save button, or a local-model card (for NVIDIA
 * Parakeet, or Apple FM on the rewrite side).
 */
export const Models = () => {
  const { t } = useI18n();
  const { models, setModels } = useAppStore();
  const [deepgramKey, setDeepgramKey] = useState("");
  const [googleSpeechKey, setGoogleSpeechKey] = useState("");
  const [googleProjectId, setGoogleProjectId] = useState("");
  const [googleRegion, setGoogleRegion] = useState("us");
  const [geminiKey, setGeminiKey] = useState("");
  const [alibabaKey, setAlibabaKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [action, setAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [d, gs, gp, gr, g, a, o, q] = await Promise.all([
        getSetting("speech_deepgram_api_key").catch(() => ""),
        getSetting("speech_google_api_key").catch(() => ""),
        getSetting("speech_google_project_id").catch(() => ""),
        getSetting("speech_google_region").catch(() => "us"),
        getSetting("gemini_api_key").catch(() => ""),
        getSetting("alibaba_api_key").catch(() => ""),
        getSetting("speech_openai_api_key").catch(() => ""),
        getSetting("groq_api_key").catch(() => ""),
      ]);
      if (!active) return;
      setDeepgramKey(d);
      setGoogleSpeechKey(gs);
      setGoogleProjectId(gp);
      setGoogleRegion(gr || "us");
      setGeminiKey(g);
      setAlibabaKey(a);
      setOpenAiKey(o);
      setGroqKey(q);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  // ---- Speech-model dropdown: flatten all providers' options into one list.
  type SpeechOpt = { value: string; provider: SpeechProvider; model: string };
  const speechFlat: SpeechOpt[] = speechProviderOptions.flatMap((provider) =>
    getSpeechModelOptions(provider).map((option) => ({
      value: `${provider}::${option.setting}`,
      provider,
      model: option.label,
    })),
  );
  const speechValue = `${models.speechProvider}::${models.speechModel}`;
  const speechSelected =
    speechFlat.find((option) => option.value === speechValue) ?? speechFlat[0];

  const selectSpeechModel = async (compositeValue: string) => {
    const [provider, ...rest] = compositeValue.split("::");
    const setting = rest.join("::");
    const option = getSpeechModelOptions(provider as SpeechProvider).find(
      (entry) => entry.setting === setting,
    );
    if (!option) return;
    await setModels({
      speechProvider: provider as SpeechProvider,
      speechModel: option.label,
    });
  };

  // ---- Rewrite-model dropdown
  type RewriteOpt = { value: string; provider: RewriteProvider; model: string };
  const rewriteFlat: RewriteOpt[] = rewriteProviderOptions.flatMap((provider) =>
    getRewriteModelOptions(provider).map((option) => ({
      value: `${provider}::${option.setting}`,
      provider,
      model: option.label,
    })),
  );
  const rewriteValue = `${models.rewriteProvider}::${models.rewriteModel}`;
  const rewriteSelected =
    rewriteFlat.find((option) => option.value === rewriteValue) ?? rewriteFlat[0];

  const selectRewriteModel = async (compositeValue: string) => {
    const [provider, ...rest] = compositeValue.split("::");
    const setting = rest.join("::");
    const option = getRewriteModelOptions(provider as RewriteProvider).find(
      (entry) => entry.setting === setting,
    );
    if (!option) return;
    await setModels({
      rewriteProvider: provider as RewriteProvider,
      rewriteModel: option.label,
    });
  };

  // ---- Validation handlers ---------------------------------------------
  const runAction = async (key: string, work: () => Promise<void>) => {
    setAction(key);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToSaveProviderSettings"));
    } finally {
      setAction(null);
    }
  };
  const saveDeepgram = () =>
    runAction("save-deepgram", async () => {
      const k = deepgramKey.trim();
      if (!k) throw new Error(t("enterDeepgramApiKeyFirst"));
      await validateDeepgramApiKey(k);
      await saveSetting("speech_deepgram_api_key", k);
      emitSettingsChanged();
      toast.info(t("deepgramKeyValidatedAndSaved"));
    });
  const saveGoogleSpeech = () =>
    runAction("save-google-speech", async () => {
      const k = googleSpeechKey.trim();
      const p = googleProjectId.trim();
      const r = googleRegion.trim() || "us";
      if (!k) throw new Error(t("enterGoogleSpeechApiKeyFirst"));
      if (!p) throw new Error(t("enterGoogleProjectIdFirst"));
      await validateGoogleSpeechConfig(k, p, r);
      await Promise.all([
        saveSetting("speech_google_api_key", k),
        saveSetting("speech_google_project_id", p),
        saveSetting("speech_google_region", r),
      ]);
      setGoogleRegion(r);
      emitSettingsChanged();
      toast.info(t("googleSpeechSettingsValidatedAndSaved"));
    });
  const saveGemini = () =>
    runAction("save-gemini", async () => {
      const k = geminiKey.trim();
      if (!k) throw new Error(t("enterGeminiApiKeyFirst"));
      await validateGeminiApiKey(k, "gemini-2.5-flash-lite");
      await saveSetting("gemini_api_key", k);
      emitSettingsChanged();
      toast.info(t("geminiKeyValidatedAndSaved"));
    });
  const saveAlibaba = () =>
    runAction("save-alibaba", async () => {
      const k = alibabaKey.trim();
      if (!k) throw new Error(t("enterAlibabaApiKeyFirst"));
      await validateAlibabaApiKey(k);
      await Promise.all([
        saveSetting("alibaba_api_key", k),
        saveSetting("alibaba_base_url", ALIBABA_BASE_URL),
      ]);
      emitSettingsChanged();
      toast.info(t("alibabaKeyValidatedAndSaved"));
    });
  const saveOpenAi = () =>
    runAction("save-openai", async () => {
      const k = openAiKey.trim();
      if (!k) throw new Error(t("enterOpenAiApiKeyFirst"));
      await validateOpenAiApiKey(k);
      await saveSetting("speech_openai_api_key", k);
      emitSettingsChanged();
      toast.info(t("openAiKeyValidatedAndSaved"));
    });
  const saveGroq = () =>
    runAction("save-groq", async () => {
      const k = groqKey.trim();
      if (!k) throw new Error("Enter a Groq API key first.");
      await validateGroqApiKey(k);
      await saveSetting("groq_api_key", k);
      emitSettingsChanged();
      toast.info("Groq API key validated and saved.");
    });

  return (
    <div>
      {/* ============ SPEECH ============ */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">Speech</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <AudioLines strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Speech model</div>
            <div className="s-desc">Used to transcribe your speech to text.</div>
          </div>
          <div className="s-control">
            <Dropdown<string>
              value={speechValue}
              minWidth={260}
              options={speechFlat.map((option) => ({
                value: option.value,
                label: `${option.provider} — ${option.model}`,
                leading: <ProviderLogo provider={option.provider} />,
              }))}
              onChange={(value) => void selectSpeechModel(value)}
              renderTriggerLabel={(option) => (
                <>
                  {option.leading}
                  <span className="dropdown-label">
                    {speechSelected.provider} — {speechSelected.model}
                  </span>
                </>
              )}
            />
          </div>
        </div>

        <SpeechKeyRow
          provider={models.speechProvider}
          deepgramKey={deepgramKey}
          setDeepgramKey={setDeepgramKey}
          googleSpeechKey={googleSpeechKey}
          setGoogleSpeechKey={setGoogleSpeechKey}
          googleProjectId={googleProjectId}
          setGoogleProjectId={setGoogleProjectId}
          googleRegion={googleRegion}
          setGoogleRegion={setGoogleRegion}
          openAiKey={openAiKey}
          setOpenAiKey={setOpenAiKey}
          alibabaKey={alibabaKey}
          setAlibabaKey={setAlibabaKey}
          action={action}
          saveDeepgram={saveDeepgram}
          saveGoogleSpeech={saveGoogleSpeech}
          saveOpenAi={saveOpenAi}
          saveAlibaba={saveAlibaba}
        />
      </div>

      {/* ============ REWRITE ============ */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">Rewrite</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <PenLine strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Rewrite model</div>
            <div className="s-desc">Used to clean up your transcribed text.</div>
          </div>
          <div className="s-control">
            <Dropdown<string>
              value={rewriteValue}
              minWidth={260}
              options={rewriteFlat.map((option) => ({
                value: option.value,
                label: `${option.provider} — ${option.model}`,
                leading: <ProviderLogo provider={option.provider} />,
              }))}
              onChange={(value) => void selectRewriteModel(value)}
              renderTriggerLabel={(option) => (
                <>
                  {option.leading}
                  <span className="dropdown-label">
                    {rewriteSelected.provider} — {rewriteSelected.model}
                  </span>
                </>
              )}
            />
          </div>
        </div>

        <RewriteKeyRow
          provider={models.rewriteProvider}
          openAiKey={openAiKey}
          setOpenAiKey={setOpenAiKey}
          geminiKey={geminiKey}
          setGeminiKey={setGeminiKey}
          alibabaKey={alibabaKey}
          setAlibabaKey={setAlibabaKey}
          groqKey={groqKey}
          setGroqKey={setGroqKey}
          action={action}
          saveGemini={saveGemini}
          saveAlibaba={saveAlibaba}
          saveOpenAi={saveOpenAi}
          saveGroq={saveGroq}
        />
      </div>
    </div>
  );
};

// ---- Single-line key row (API key input + Save button) -----------------
function KeyRow({
  label,
  description,
  placeholder,
  value,
  onChange,
  busy,
  onSave,
}: {
  label: string;
  description?: ReactNode;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  busy?: boolean;
  onSave: () => void;
}) {
  return (
    <div className="s-row">
      <div className="s-icon">
        <KeyRound strokeWidth={2} />
      </div>
      <div className="s-body">
        <div className="s-label">{label}</div>
        {description ? <div className="s-desc">{description}</div> : null}
      </div>
      <div className="s-control">
        <div className="field-row">
          <input
            type="password"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className="s-input pw"
          />
          <button type="button" className="btn" onClick={onSave} disabled={busy}>
            {busy ? <Loader2 size={13} strokeWidth={2} className="animate-spin" /> : null}
            Verify
          </button>
        </div>
      </div>
    </div>
  );
}

function ParakeetPackage() {
  return (
    <div className="s-row">
      <div className="s-icon">
        <FileArchive strokeWidth={2} />
      </div>
      <div className="s-body">
        <div className="s-label">Package</div>
        <div className="s-desc">600 MB on disk.</div>
      </div>
      <div className="s-control">
        <LocalModelCard modelId="parakeet-tdt-0.6b-v3-int8" />
      </div>
    </div>
  );
}

function SpeechKeyRow(props: {
  provider: SpeechProvider;
  deepgramKey: string;
  setDeepgramKey: (v: string) => void;
  googleSpeechKey: string;
  setGoogleSpeechKey: (v: string) => void;
  googleProjectId: string;
  setGoogleProjectId: (v: string) => void;
  googleRegion: string;
  setGoogleRegion: (v: string) => void;
  openAiKey: string;
  setOpenAiKey: (v: string) => void;
  alibabaKey: string;
  setAlibabaKey: (v: string) => void;
  action: string | null;
  saveDeepgram: () => Promise<void>;
  saveGoogleSpeech: () => Promise<void>;
  saveOpenAi: () => Promise<void>;
  saveAlibaba: () => Promise<void>;
}) {
  switch (props.provider) {
    case "NVIDIA":
      return <ParakeetPackage />;
    case "Deepgram":
      return (
        <KeyRow
          label="Deepgram API key"
          description="Stored locally in your macOS Keychain."
          placeholder="dg_..."
          value={props.deepgramKey}
          onChange={props.setDeepgramKey}
          busy={props.action === "save-deepgram"}
          onSave={() => void props.saveDeepgram()}
        />
      );
    case "OpenAI":
      return (
        <KeyRow
          label="OpenAI API key"
          description="Stored locally in your macOS Keychain."
          placeholder="sk-..."
          value={props.openAiKey}
          onChange={props.setOpenAiKey}
          busy={props.action === "save-openai"}
          onSave={() => void props.saveOpenAi()}
        />
      );
    case "Alibaba":
      return (
        <KeyRow
          label="Alibaba API key"
          description="Stored locally in your macOS Keychain."
          placeholder="sk-..."
          value={props.alibabaKey}
          onChange={props.setAlibabaKey}
          busy={props.action === "save-alibaba"}
          onSave={() => void props.saveAlibaba()}
        />
      );
  }
}

function RewriteKeyRow(props: {
  provider: RewriteProvider;
  openAiKey: string;
  setOpenAiKey: (v: string) => void;
  geminiKey: string;
  setGeminiKey: (v: string) => void;
  alibabaKey: string;
  setAlibabaKey: (v: string) => void;
  groqKey: string;
  setGroqKey: (v: string) => void;
  action: string | null;
  saveGemini: () => Promise<void>;
  saveAlibaba: () => Promise<void>;
  saveOpenAi: () => Promise<void>;
  saveGroq: () => Promise<void>;
}) {
  switch (props.provider) {
    case "Apple":
      return <AppleFmRow />;
    case "OpenAI":
      return (
        <KeyRow
          label="OpenAI API key"
          description="Stored locally in your macOS Keychain."
          placeholder="sk-..."
          value={props.openAiKey}
          onChange={props.setOpenAiKey}
          busy={props.action === "save-openai"}
          onSave={() => void props.saveOpenAi()}
        />
      );
    case "Google":
      return (
        <KeyRow
          label="Gemini API key"
          description="Stored locally in your macOS Keychain."
          placeholder="AIza..."
          value={props.geminiKey}
          onChange={props.setGeminiKey}
          busy={props.action === "save-gemini"}
          onSave={() => void props.saveGemini()}
        />
      );
    case "Alibaba":
      return (
        <KeyRow
          label="Alibaba API key"
          description="Stored locally in your macOS Keychain."
          placeholder="sk-..."
          value={props.alibabaKey}
          onChange={props.setAlibabaKey}
          busy={props.action === "save-alibaba"}
          onSave={() => void props.saveAlibaba()}
        />
      );
    case "Groq":
      return (
        <KeyRow
          label="Groq API key"
          description="Stored locally in your macOS Keychain."
          placeholder="gsk_..."
          value={props.groqKey}
          onChange={props.setGroqKey}
          busy={props.action === "save-groq"}
          onSave={() => void props.saveGroq()}
        />
      );
  }
}

// ---- Apple FM status row ------------------------------------------------
function AppleFmRow() {
  const [status, setStatus] = useState<AppleFmAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = async () => {
    setChecking(true);
    try {
      setStatus(await appleFmAvailability());
    } catch {
      setStatus("unavailable");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const { headline, detail, mint } = describeAppleFmStatus(status);

  // Hide the status pill when the model is fully ready — design only
  // surfaces it when there's something the user needs to act on.
  const showStatusPill = status !== null && status !== "available";

  return (
    <div className="s-row">
      <div className="s-icon">
        <Apple strokeWidth={2} />
      </div>
      <div className="s-body">
        <div className="s-label" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          Apple Foundation Models
          {showStatusPill && (
            <span
              className="mono-label"
              style={{
                fontSize: "9.5px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: mint ? "var(--ai-soft)" : "var(--bg-elev-3)",
                border: mint
                  ? "1px solid oklch(0.65 0.17 var(--ai-h) / 0.3)"
                  : "1px solid var(--hairline)",
                color: mint ? "var(--ai)" : "var(--text-muted)",
              }}
            >
              {headline}
            </span>
          )}
        </div>
        <div className="s-desc">{detail}</div>
      </div>
      <div className="s-control">
        <button type="button" className="btn" onClick={() => void refresh()} disabled={checking}>
          {checking ? (
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
          ) : (
            <RefreshCw size={13} strokeWidth={2} />
          )}
          {checking ? "Checking…" : "Recheck"}
        </button>
      </div>
    </div>
  );
}

function describeAppleFmStatus(status: AppleFmAvailability | null): {
  headline: string;
  detail: string;
  mint: boolean;
} {
  switch (status) {
    case "available":
      return {
        headline: "Ready",
        detail: "Apple Intelligence must be enabled.",
        mint: true,
      };
    case "unavailable":
      return {
        headline: "Not ready",
        detail:
          "macOS reports the system model isn't reachable. Enable Apple Intelligence in System Settings.",
        mint: false,
      };
    case "not-built":
      return {
        headline: "Helper missing",
        detail:
          "The Swift helper wasn't compiled at build time (needs swiftc + macOS 26 SDK).",
        mint: false,
      };
    case "unsupported":
      return {
        headline: "macOS only",
        detail: "Apple Foundation Models is only available on macOS 26+.",
        mint: false,
      };
    case null:
      return { headline: "Checking", detail: "Probing the Foundation Models framework…", mint: false };
  }
}
