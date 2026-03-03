import { useState } from "react";
import GeneralSettings from "./components/GeneralSettings";
import RewriteSettings from "./components/RewriteSettings";
import VocabularyManager from "./components/VocabularyManager";
import HistoryViewer from "./components/HistoryViewer";
import { useI18n } from "./lib/i18n";

const tabs = [
  { id: "general", labelKey: "tabGeneral" },
  { id: "setup", labelKey: "tabRewrite" },
  { id: "custom-vocabulary", labelKey: "tabVocabulary" },
  { id: "history", labelKey: "tabHistory" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const { t } = useI18n();

  return (
    <div className="h-screen bg-transparent p-4 md:p-5">
        <div className="app-shell flex h-full flex-col overflow-hidden rounded-[30px] border border-neutral-800/90">
        <div className="flex items-start justify-between border-b border-neutral-800/80 px-7 pt-6 pb-7">
          <div>
            <h1 className="app-title-display text-neutral-100" aria-label={t("appTitle")}>
              {t("appTitle")}
            </h1>
            <p className="app-subtitle-copy">{t("appSubtitle")}</p>
          </div>
          <div className="text-right leading-tight">
            <div className="text-xs text-neutral-300/90">{t("developedBy")}</div>
            <div className="mt-1 text-[11px] text-neutral-500">{t("version")}</div>
          </div>
        </div>

        <div className="border-b border-neutral-800/80 bg-neutral-950/20 px-7 pt-3 pb-0">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={selected ? "page" : undefined}
                  className={tabClass(selected)}
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-transparent">
          <div className="mx-auto w-full max-w-5xl">
          {activeTab === "general" && <GeneralSettings />}
          {activeTab === "setup" && <RewriteSettings />}
          {activeTab === "custom-vocabulary" && <VocabularyManager />}
          {activeTab === "history" && <HistoryViewer />}
          </div>
        </div>
      </div>
    </div>
  );
}

function tabClass(selected: boolean) {
  return [
    "relative -mb-px cursor-pointer border-b-2 bg-transparent px-0 pb-3 text-sm transition-colors",
    selected
      ? "border-white text-white font-bold"
      : "border-transparent text-white/70 font-semibold hover:border-white/15 hover:text-white/90",
  ].join(" ");
}
