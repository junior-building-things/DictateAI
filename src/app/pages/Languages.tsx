import { useEffect, useState } from "react";
import { Languages as LanguagesIcon, Monitor, Speech } from "lucide-react";
import { toast } from "sonner";
import { Dropdown } from "../../components/Dropdown";
import { getSetting, saveSetting } from "../../lib/commands";
import { getLanguageOptions, translateForLanguage, useI18n, type LanguageCode } from "../../lib/i18n";

const LANGUAGE_OPTIONS = getLanguageOptions();

/**
 * Settings → Languages. Matches the design file's `languages:` panel:
 * single group (no group header), three rows — App language, Spoken language
 * (mint mic icon), Target language. Each row uses the custom Dropdown.
 */
export const Languages = () => {
  const { language: interfaceLanguage, setLanguage, t } = useI18n();
  const [spokenLanguage, setSpokenLanguage] = useState("en");
  const [translationLanguage, setTranslationLanguage] = useState("same");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [a, b] = await Promise.all([
        getSetting("language").catch(() => "en"),
        getSetting("translation_language").catch(() => "same"),
      ]);
      if (!active) return;
      setSpokenLanguage(a || "en");
      setTranslationLanguage(b || "same");
      setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return null;

  const appOptions = LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  const spokenOptions = appOptions;
  const targetOptions = [{ value: "same", label: t("sameAsSpoken") }, ...appOptions];

  return (
    <div>
      <div className="s-group">
        <div className="s-row">
          <div className="s-icon">
            <Monitor strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("interfaceLanguage")}</div>
            <div className="s-desc">{t("appLanguageDesc")}</div>
          </div>
          <div className="s-control">
            <Dropdown
              value={interfaceLanguage}
              options={appOptions}
              onChange={(value) => {
                const next = value as LanguageCode;
                void setLanguage(next);
                toast.info(translateForLanguage(next, "appLanguageUpdated"));
              }}
            />
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Speech strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("spokenLanguage")}</div>
            <div className="s-desc">{t("spokenLanguageDesc")}</div>
          </div>
          <div className="s-control">
            <Dropdown
              value={spokenLanguage}
              options={spokenOptions}
              onChange={(value) => {
                setSpokenLanguage(value);
                void saveSetting("language", value);
                toast.info(t("spokenLanguageUpdated"));
              }}
            />
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <LanguagesIcon strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("translationLanguage")}</div>
            <div className="s-desc">{t("targetLanguageDesc")}</div>
          </div>
          <div className="s-control">
            <Dropdown
              value={translationLanguage}
              options={targetOptions}
              onChange={(value) => {
                setTranslationLanguage(value);
                void saveSetting("translation_language", value);
                toast.info(t("targetLanguageUpdated"));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
