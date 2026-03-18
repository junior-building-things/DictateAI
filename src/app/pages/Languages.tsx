import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  Info,
  Languages as LanguagesIcon,
  Monitor,
  Speech,
} from "lucide-react";
import { toast } from "sonner";
import { getSetting, saveSetting } from "../../lib/commands";
import { getLanguageOptions, translateForLanguage, useI18n, type LanguageCode } from "../../lib/i18n";
import { cn } from "../../lib/utils";

const LANGUAGE_OPTIONS = getLanguageOptions();

export const Languages = () => {
  const { language: interfaceLanguage, setLanguage, t } = useI18n();
  const [spokenLanguage, setSpokenLanguage] = useState("en");
  const [translationLanguage, setTranslationLanguage] = useState("same");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [savedLanguage, savedTranslation] = await Promise.all([
        getSetting("language").catch(() => "en"),
        getSetting("translation_language").catch(() => "same"),
      ]);
      if (!active) return;
      setSpokenLanguage(savedLanguage || "en");
      setTranslationLanguage(savedTranslation || "same");
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const targetLanguageOptions = [
    { value: "same", label: t("sameAsSpoken") },
    ...LANGUAGE_OPTIONS,
  ];

  const labelForCode = (code: string): string => {
    if (code === "same") {
      return t("sameAsSpoken");
    }

    return LANGUAGE_OPTIONS.find((option) => option.value === code)?.label ?? code;
  };

  const handleInterfaceLanguageChange = (value: string) => {
    const nextLanguage = value as LanguageCode;
    void setLanguage(nextLanguage);
    toast.info(translateForLanguage(nextLanguage, "appLanguageUpdated"));
  };

  const handleSpokenLanguageChange = (value: string) => {
    setSpokenLanguage(value);
    void saveSetting("language", value);
    toast.info(t("spokenLanguageUpdated"));
  };

  const handleTranslationLanguageChange = (value: string) => {
    setTranslationLanguage(value);
    void saveSetting("translation_language", value);
    toast.info(t("targetLanguageUpdated"));
  };

  const translationActive =
    translationLanguage !== "same" && translationLanguage !== spokenLanguage;

  if (loading) return null;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">{t("navLanguages")}</h1>
        <p className="text-neutral-400">{t("languagesSubtitle")}</p>
      </header>

      <div className="grid gap-8 xl:grid-cols-3">
        <LanguageCard
          icon={<Monitor className="h-5 w-5" />}
          title={t("interfaceLanguage")}
          description={t("appLanguageDesc")}
        >
          <LanguageSelect
            options={LANGUAGE_OPTIONS}
            value={interfaceLanguage}
            onChange={handleInterfaceLanguageChange}
          />
        </LanguageCard>

        <LanguageCard
          icon={<Speech className="h-5 w-5" />}
          title={t("spokenLanguage")}
          description={t("spokenLanguageDesc")}
        >
          <LanguageSelect
            options={LANGUAGE_OPTIONS}
            value={spokenLanguage}
            onChange={handleSpokenLanguageChange}
          />
        </LanguageCard>

        <LanguageCard
          icon={<LanguagesIcon className="h-5 w-5" />}
          title={t("translationLanguage")}
          description={t("targetLanguageDesc")}
        >
          <div className="space-y-4">
            <LanguageSelect
              options={targetLanguageOptions}
              value={translationLanguage}
              onChange={handleTranslationLanguageChange}
            />

            {translationActive && (
              <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
                <p className="text-sm text-blue-300/80">
                  {t("translationActiveMsg", {
                    from: labelForCode(spokenLanguage),
                    to: labelForCode(translationLanguage),
                  })}
                </p>
              </div>
            )}
          </div>
        </LanguageCard>
      </div>
    </div>
  );
};

const LanguageSelect = ({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white transition-all hover:bg-white/[0.05] focus:ring-1 focus:ring-blue-500/50"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-neutral-500 transition-transform",
            isOpen && "rotate-180",
          )}
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
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <span className="truncate">{option.label}</span>
                  {value === option.value ? (
                    <Check className="h-4 w-4 text-blue-500" />
                  ) : null}
                </button>
              ))}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

const LanguageCard = ({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-[#121212] p-8">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
        {icon}
      </div>
      <div>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
        <p className="text-sm text-neutral-500">{description}</p>
      </div>
    </div>
    <div>{children}</div>
  </section>
);
