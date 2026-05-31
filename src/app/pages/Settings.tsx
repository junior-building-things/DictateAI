import { useEffect, useState } from "react";
import { Cpu, Globe, Sparkles, SlidersHorizontal } from "lucide-react";

import { Home as GeneralPanel } from "./Home";
import { Languages as LanguagesPanel } from "./Languages";
import { Models as ModelsPanel } from "./Models";
import { RewriteRules as RewriteRulesPanel } from "./RewriteRules";
import { useI18n } from "../../lib/i18n";

type Tab = "general" | "languages" | "models" | "rewrite";

const STORAGE_KEY = "dictateai.settingsTab";

const TABS: Array<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "languages", label: "Languages", icon: Globe },
  { id: "models", label: "Models", icon: Cpu },
  { id: "rewrite", label: "Rewrite Rules", icon: Sparkles },
];

export const Settings = () => {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "general";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "general" || saved === "languages" || saved === "models" || saved === "rewrite") {
      return saved;
    }
    return "general";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, tab);
    }
  }, [tab]);

  const tabLabels: Record<Tab, string> = {
    general: t("generalLabel"),
    languages: t("navLanguages"),
    models: t("navModels"),
    rewrite: t("navRewriteRules"),
  };

  return (
    <>
      <div className="tabbar">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              className={`tab ${tab === entry.id ? "active" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              <Icon strokeWidth={2} />
              <span>{tabLabels[entry.id]}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content sits inside the scroll wrapper; the `.tabbar` above
       * stays fixed. Re-mount on tab change so `.screen-fade` replays. */}
      <div className="page-scroll">
        <div key={tab} className="page-body screen-fade">
          {tab === "general" && <GeneralPanel />}
          {tab === "languages" && <LanguagesPanel />}
          {tab === "models" && <ModelsPanel />}
          {tab === "rewrite" && <RewriteRulesPanel />}
        </div>
      </div>
    </>
  );
};
