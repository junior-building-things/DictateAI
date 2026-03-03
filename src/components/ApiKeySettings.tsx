import { useEffect, useState } from "react";
import { getSetting, saveSetting, validateGeminiApiKey, validateOpenAiApiKey } from "../lib/commands";
import { useI18n } from "../lib/i18n";

export default function ApiKeySettings() {
  const { t, language } = useI18n();
  const copy = getApiKeyCopy(language);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [isValidatingGemini, setIsValidatingGemini] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<"idle" | "success" | "error">("idle");
  const [geminiMessage, setGeminiMessage] = useState("");
  const [isValidatingOpenAi, setIsValidatingOpenAi] = useState(false);
  const [openAiStatus, setOpenAiStatus] = useState<"idle" | "success" | "error">("idle");
  const [openAiMessage, setOpenAiMessage] = useState("");

  useEffect(() => {
    Promise.all([
      getSetting("gemini_api_key").catch(() => ""),
      getSetting("speech_openai_api_key").catch(() => ""),
    ])
      .then(([geminiKey, openaiKey]) => {
        setGeminiApiKey(geminiKey);
        setOpenaiApiKey(openaiKey);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSaveGemini = async () => {
    setIsValidatingGemini(true);
    setGeminiStatus("idle");
    setGeminiMessage("");

    try {
      await validateGeminiApiKey(geminiApiKey, "gemini-2.5-flash-lite");
      await saveSetting("gemini_api_key", geminiApiKey);
      setGeminiStatus("success");
      setGeminiMessage(t("apiKeyValid"));
    } catch (error) {
      setGeminiStatus("error");
      void error;
      setGeminiMessage(t("apiKeyInvalid"));
    } finally {
      setIsValidatingGemini(false);
    }
  };

  const handleSaveOpenAi = async () => {
    setIsValidatingOpenAi(true);
    setOpenAiStatus("idle");
    setOpenAiMessage("");

    try {
      await validateOpenAiApiKey(openaiApiKey);
      await saveSetting("speech_openai_api_key", openaiApiKey.trim());
      setOpenAiStatus("success");
      setOpenAiMessage(copy.validSaved);
    } catch (error) {
      setOpenAiStatus("error");
      void error;
      setOpenAiMessage(copy.invalid);
    } finally {
      setIsValidatingOpenAi(false);
    }
  };

  if (loading) return <div className="text-sm text-neutral-500">{t("loading")}</div>;

  return (
    <section className="surface-card space-y-4 p-6">
      <h3 className="section-title">{copy.sectionTitle}</h3>
      <p className="field-help">{copy.sectionHelp}</p>

      <label className="field-label block">{copy.openaiLabel}</label>
      <div className="flex gap-2">
        <input
          type="password"
          value={openaiApiKey}
          onChange={(e) => {
            setOpenaiApiKey(e.target.value);
            setOpenAiStatus("idle");
            setOpenAiMessage("");
          }}
          placeholder="sk-..."
          className="input-control flex-1"
        />
        <button
          onClick={() => void handleSaveOpenAi()}
          disabled={isValidatingOpenAi || !openaiApiKey.trim()}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isValidatingOpenAi ? t("validating") : t("validateAndSave")}
        </button>
      </div>
      {isValidatingOpenAi && <p className="text-xs text-neutral-400">{copy.testingOpenAi}</p>}
      {!isValidatingOpenAi && openAiStatus === "success" && (
        <p className="text-xs text-emerald-300">{openAiMessage}</p>
      )}
      {!isValidatingOpenAi && openAiStatus === "error" && (
        <p className="text-xs text-red-300">{openAiMessage}</p>
      )}

      <label className="field-label block">{copy.geminiLabel}</label>
      <div className="flex gap-2">
        <input
          type="password"
          value={geminiApiKey}
          onChange={(e) => {
            setGeminiApiKey(e.target.value);
            setGeminiStatus("idle");
            setGeminiMessage("");
          }}
          placeholder={t("enterApiKey")}
          className="input-control flex-1"
        />
        <button
          onClick={() => void handleSaveGemini()}
          disabled={isValidatingGemini || !geminiApiKey.trim()}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isValidatingGemini ? t("validating") : t("validateAndSave")}
        </button>
      </div>

      {isValidatingGemini && (
        <p className="text-xs text-neutral-400">{t("validatingWithGemini")}</p>
      )}

      {!isValidatingGemini && geminiStatus === "success" && (
        <p className="text-xs text-emerald-300">{geminiMessage}</p>
      )}

      {!isValidatingGemini && geminiStatus === "error" && (
        <p className="text-xs text-red-300">{geminiMessage}</p>
      )}
    </section>
  );
}

function getApiKeyCopy(language: string) {
  const copy = {
    en: {
      sectionTitle: "API Keys",
      sectionHelp: "Make sure you've enabled API billing in your OpenAI and GCP accounts.",
      openaiLabel: "OpenAI API Key",
      geminiLabel: "Gemini API Key",
      testingOpenAi: "Testing OpenAI API Key...",
      validSaved: "API key is valid and saved.",
      invalid: "API key validation failed.",
    },
    sv: {
      sectionTitle: "API-nycklar",
      sectionHelp: "Se till att API-fakturering är aktiverad i dina OpenAI- och GCP-konton.",
      openaiLabel: "OpenAI API-nyckel",
      geminiLabel: "Gemini API-nyckel",
      testingOpenAi: "Testar OpenAI API-nyckel...",
      validSaved: "API-nyckeln är giltig och sparad.",
      invalid: "Validering av API-nyckeln misslyckades.",
    },
    fi: {
      sectionTitle: "API-avaimet",
      sectionHelp: "Varmista, että API-laskutus on otettu käyttöön OpenAI- ja GCP-tileilläsi.",
      openaiLabel: "OpenAI API-avain",
      geminiLabel: "Gemini API-avain",
      testingOpenAi: "Testataan OpenAI API-avainta...",
      validSaved: "API-avain on kelvollinen ja tallennettu.",
      invalid: "API-avaimen vahvistus epäonnistui.",
    },
    es: {
      sectionTitle: "Claves de API",
      sectionHelp: "Asegurate de haber habilitado la facturacion de API en tus cuentas de OpenAI y GCP.",
      openaiLabel: "Clave de API de OpenAI",
      geminiLabel: "Clave de API de Gemini",
      testingOpenAi: "Probando la clave de API de OpenAI...",
      validSaved: "La clave de API es válida y se ha guardado.",
      invalid: "La validación de la clave de API ha fallado.",
    },
    fr: {
      sectionTitle: "Clés API",
      sectionHelp: "Assurez-vous d'avoir active la facturation API sur vos comptes OpenAI et GCP.",
      openaiLabel: "Clé API OpenAI",
      geminiLabel: "Clé API Gemini",
      testingOpenAi: "Vérification de la clé API OpenAI...",
      validSaved: "La clé API est valide et enregistrée.",
      invalid: "La validation de la clé API a échoué.",
    },
    de: {
      sectionTitle: "API-Schlüssel",
      sectionHelp: "Stelle sicher, dass die API-Abrechnung in deinen OpenAI- und GCP-Konten aktiviert ist.",
      openaiLabel: "OpenAI-API-Schlüssel",
      geminiLabel: "Gemini-API-Schlüssel",
      testingOpenAi: "OpenAI-API-Schlüssel wird geprüft...",
      validSaved: "Der API-Schlüssel ist gültig und gespeichert.",
      invalid: "Die API-Schlüssel-Prüfung ist fehlgeschlagen.",
    },
    ja: {
      sectionTitle: "APIキー",
      sectionHelp: "OpenAI と GCP のアカウントで API の課金を有効にしていることを確認してください。",
      openaiLabel: "OpenAI APIキー",
      geminiLabel: "Gemini APIキー",
      testingOpenAi: "OpenAI APIキーを確認中...",
      validSaved: "APIキーは有効で保存されました。",
      invalid: "APIキーの検証に失敗しました。",
    },
    zh: {
      sectionTitle: "API 密钥",
      sectionHelp: "请确保你已在 OpenAI 和 GCP 账户中启用 API 计费。",
      openaiLabel: "OpenAI API 密钥",
      geminiLabel: "Gemini API 密钥",
      testingOpenAi: "正在测试 OpenAI API 密钥...",
      validSaved: "API 密钥有效且已保存。",
      invalid: "API 密钥验证失败。",
    },
  } as const;

  return copy[language as keyof typeof copy] ?? copy.en;
}
