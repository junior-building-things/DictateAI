import { useEffect, useState } from "react";
import { getDefaultSystemPrompt, getSetting, saveSetting } from "../lib/commands";
import { useI18n } from "../lib/i18n";

const PROMPT_KEY = "rewrite_system_prompt";

export default function PromptSettings() {
  const { t, language } = useI18n();
  const copy = getPromptCopy(language);
  const [prompt, setPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [updated, setUpdated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [defaultValue, storedValue] = await Promise.all([
        getDefaultSystemPrompt(),
        getSetting(PROMPT_KEY).catch(() => ""),
      ]);
      setDefaultPrompt(defaultValue);
      setPrompt(storedValue.trim() ? storedValue : defaultValue);
      setLoading(false);
    };
    void load();
  }, []);

  const handleSave = async () => {
    await saveSetting(PROMPT_KEY, prompt.trim());
    setUpdated(true);
    setTimeout(() => setUpdated(false), 2000);
  };

  const handleReset = async () => {
    setPrompt(defaultPrompt);
    await saveSetting(PROMPT_KEY, "");
    setUpdated(true);
    setTimeout(() => setUpdated(false), 2000);
  };

  if (loading) return <div className="text-sm text-neutral-500">{t("loading")}</div>;

  return (
    <section className="surface-card space-y-5 p-6">
      <div className="space-y-2">
        <h3 className="section-title">{copy.title}</h3>
        <p className="field-help">{copy.description}</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          className="btn-primary"
        >
          {updated ? copy.updated : copy.update}
        </button>
        <button
          onClick={handleReset}
          className="btn-secondary"
        >
          {t("restoreDefault")}
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="input-control h-80 resize-y rounded-2xl p-4 text-sm leading-relaxed text-neutral-200"
      />
    </section>
  );
}

function getPromptCopy(language: string) {
  const copy = {
    en: {
      title: "System Prompt",
      description:
        "This prompt controls how the model rewrites your transcript. Keep instructions clear and concise for optimal performance.",
      update: "Update Prompt",
      updated: "Updated",
    },
    sv: {
      title: "Systemprompt",
      description:
        "Den här prompten styr hur modellen skriver om din transkribering. Håll instruktionerna tydliga och kortfattade för bästa resultat.",
      update: "Uppdatera Prompt",
      updated: "Uppdaterad",
    },
    fi: {
      title: "Järjestelmäkehote",
      description:
        "Tämä kehote ohjaa, miten malli kirjoittaa litterointisi uudelleen. Pidä ohjeet selkeinä ja tiiviinä parhaan suorituskyvyn saavuttamiseksi.",
      update: "Päivitä Kehote",
      updated: "Päivitetty",
    },
    es: {
      title: "Prompt del Sistema",
      description:
        "Este prompt controla cómo el modelo reescribe tu transcripción. Mantén las instrucciones claras y concisas para obtener el mejor rendimiento.",
      update: "Actualizar Prompt",
      updated: "Actualizado",
    },
    fr: {
      title: "Prompt Système",
      description:
        "Ce prompt contrôle la façon dont le modèle réécrit votre transcription. Gardez des instructions claires et concises pour des performances optimales.",
      update: "Mettre à Jour le Prompt",
      updated: "Mis à Jour",
    },
    de: {
      title: "System-Prompt",
      description:
        "Dieser Prompt steuert, wie das Modell dein Transkript umschreibt. Halte die Anweisungen klar und präzise für die beste Leistung.",
      update: "Prompt Aktualisieren",
      updated: "Aktualisiert",
    },
    ja: {
      title: "システムプロンプト",
      description:
        "このプロンプトは、モデルが文字起こしをどのように書き換えるかを制御します。最適なパフォーマンスのため、指示は明確かつ簡潔にしてください。",
      update: "プロンプトを更新",
      updated: "更新済み",
    },
    zh: {
      title: "系统提示词",
      description:
        "此提示词用于控制模型如何改写你的转写内容。为获得最佳效果，请保持指令清晰且简洁。",
      update: "更新提示词",
      updated: "已更新",
    },
  } as const;

  return copy[language as keyof typeof copy] ?? copy.en;
}
