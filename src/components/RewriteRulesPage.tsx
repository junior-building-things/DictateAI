import type { ReactNode } from "react";
import { SparklesIcon, GlobeIcon } from "./AppIcons";
import PromptSettings from "./PromptSettings";
import VocabularyManager from "./VocabularyManager";
import { useI18n, type LanguageCode } from "../lib/i18n";

export default function RewriteRulesPage() {
  const { language } = useI18n();
  const copy = getRewriteRulesCopy(language);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
          {copy.title}
        </h1>
        <p className="max-w-2xl text-sm leading-7 text-neutral-400 md:text-base">
          {copy.subtitle}
        </p>
      </header>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <FeatureCard
            icon={<SparklesIcon className="h-5 w-5" />}
            eyebrow={copy.promptEyebrow}
            title={copy.promptTitle}
            description={copy.promptDescription}
          />
          <PromptSettings />
        </div>

        <div className="space-y-6">
          <FeatureCard
            icon={<GlobeIcon className="h-5 w-5" />}
            eyebrow={copy.dictionaryEyebrow}
            title={copy.dictionaryTitle}
            description={copy.dictionaryDescription}
          />
          <VocabularyManager />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300">
          {icon}
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
            {eyebrow}
          </div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          <p className="text-sm leading-7 text-neutral-400">{description}</p>
        </div>
      </div>
    </section>
  );
}

function getRewriteRulesCopy(language: LanguageCode) {
  const copy = {
    en: {
      title: "Rewrite Rules",
      subtitle: "Tune how DictateAI cleans spoken text and maintain the dictionary that protects your important terminology.",
      promptEyebrow: "System prompt",
      promptTitle: "Rewrite behavior",
      promptDescription: "Use the system prompt to define how aggressively the model cleans, restructures, or preserves spoken phrasing.",
      dictionaryEyebrow: "Custom dictionary",
      dictionaryTitle: "Protected terms",
      dictionaryDescription: "Keep company names, product names, and internal terminology consistent across transcription and rewrite.",
    },
    es: {
      title: "Reglas de reescritura",
      subtitle: "Ajusta como DictateAI limpia el texto hablado y mantén el diccionario que protege tu terminologia importante.",
      promptEyebrow: "Prompt del sistema",
      promptTitle: "Comportamiento de reescritura",
      promptDescription: "Usa el prompt del sistema para definir cuanto limpia, reestructura o preserva el modelo.",
      dictionaryEyebrow: "Diccionario personalizado",
      dictionaryTitle: "Terminos protegidos",
      dictionaryDescription: "Mantén nombres de empresa, productos y terminologia interna consistentes.",
    },
    fr: {
      title: "Regles de reecriture",
      subtitle: "Ajustez la facon dont DictateAI nettoie le texte parle et maintenez le dictionnaire qui protege votre terminologie importante.",
      promptEyebrow: "Prompt systeme",
      promptTitle: "Comportement de reecriture",
      promptDescription: "Utilisez le prompt systeme pour definir le niveau de nettoyage, de restructuration ou de preservation.",
      dictionaryEyebrow: "Dictionnaire personnalise",
      dictionaryTitle: "Termes proteges",
      dictionaryDescription: "Gardez coherents les noms d'entreprise, de produits et la terminologie interne.",
    },
    de: {
      title: "Umschreibregeln",
      subtitle: "Steuere, wie DictateAI gesprochene Texte bereinigt, und pflege das Worterbuch fur wichtige Begriffe.",
      promptEyebrow: "System-Prompt",
      promptTitle: "Umschreibverhalten",
      promptDescription: "Lege uber den System-Prompt fest, wie stark das Modell bereinigt, umstellt oder Formulierungen bewahrt.",
      dictionaryEyebrow: "Eigenes Worterbuch",
      dictionaryTitle: "Geschutzte Begriffe",
      dictionaryDescription: "Halte Firmen-, Produkt- und interne Begriffe uber Transkription und Umschreiben hinweg konsistent.",
    },
    ja: {
      title: "リライトルール",
      subtitle: "DictateAI が話し言葉をどう整えるかを調整し、重要な用語を守る辞書を管理します。",
      promptEyebrow: "システムプロンプト",
      promptTitle: "リライトの挙動",
      promptDescription: "どの程度まで整形・再構成・原文保持を行うかをシステムプロンプトで定義します。",
      dictionaryEyebrow: "カスタム辞書",
      dictionaryTitle: "保護する用語",
      dictionaryDescription: "会社名、製品名、社内用語を文字起こしとリライトの両方で一貫させます。",
    },
    zh: {
      title: "改写规则",
      subtitle: "调整 DictateAI 清理口语文本的方式，并维护保护关键术语的一致性词典。",
      promptEyebrow: "系统提示词",
      promptTitle: "改写行为",
      promptDescription: "通过系统提示词定义模型清理、重组或保留原话的力度。",
      dictionaryEyebrow: "自定义词典",
      dictionaryTitle: "受保护术语",
      dictionaryDescription: "确保公司名、产品名和内部术语在转写与改写中保持一致。",
    },
    sv: {
      title: "Omskrivningsregler",
      subtitle: "Justera hur DictateAI stadar talad text och hall ordlistan uppdaterad for viktig terminologi.",
      promptEyebrow: "Systemprompt",
      promptTitle: "Omskrivningsbeteende",
      promptDescription: "Anvand systemprompten for att styra hur mycket modellen stadar, omstrukturerar eller bevarar formuleringar.",
      dictionaryEyebrow: "Egen ordlista",
      dictionaryTitle: "Skyddade termer",
      dictionaryDescription: "Hall foretagsnamn, produktnamn och intern terminologi konsekvent i hela flodet.",
    },
    fi: {
      title: "Uudelleenkirjoitussaannot",
      subtitle: "Saea miten DictateAI siivoaa puhetekstin ja yllapida sanastoa, joka suojaa tarkeaa terminologiaa.",
      promptEyebrow: "Jarjestelmakehote",
      promptTitle: "Uudelleenkirjoituksen kaytos",
      promptDescription: "Maarita jarjestelmakehotteella kuinka voimakkaasti malli siivoaa, jarjestelee tai sailyttaa puhutun muodon.",
      dictionaryEyebrow: "Mukautettu sanasto",
      dictionaryTitle: "Suojatut termit",
      dictionaryDescription: "Pida yritys-, tuote- ja sisainen terminologia yhtenaisena koko putkessa.",
    },
  } as const;

  return copy[language] ?? copy.en;
}
