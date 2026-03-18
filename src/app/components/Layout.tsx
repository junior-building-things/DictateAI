import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { BookText, Cpu, Globe, History, Home, Mic2, Wand2 } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";
import { checkAccessibility, getSettings } from "../../lib/commands";
import { useI18n } from "../../lib/i18n";
import { type ModelsState, useAppStore } from "../../lib/store";
import { getMicrophonePermissionState } from "../../lib/ui";
import { DictationProvider } from "../../lib/useDictation";
import { cn } from "../../lib/utils";

export const Layout = () => {
  return (
    <DictationProvider>
      <LayoutInner />
    </DictationProvider>
  );
};

const LayoutInner = () => {
  const location = useLocation();
  const { t } = useI18n();
  const { models } = useAppStore();
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [missingApiKeys, setMissingApiKeys] = useState(false);
  const sidebarItems = [
    { icon: Home, label: t("navHome"), path: "/" },
    { icon: Globe, label: t("navLanguages"), path: "/languages" },
    { icon: Cpu, label: t("navModels"), path: "/models" },
    { icon: Wand2, label: t("navRewriteRules"), path: "/rewrite-rules" },
    { icon: BookText, label: t("navVocabulary"), path: "/vocabulary" },
    { icon: History, label: t("navHistory"), path: "/history" },
  ];

  const syncStatus = useCallback(async () => {
    const [microphoneState, accessibilityState, settingsEntries] = await Promise.all([
      getMicrophonePermissionState().catch(() => "unknown"),
      checkAccessibility().catch(() => false),
      getSettings().catch(() => null as [string, string][] | null),
    ]);

    setMicrophoneGranted(microphoneState === "granted");
    setAccessibilityGranted(accessibilityState === true);
    if (settingsEntries) {
      setMissingApiKeys(hasMissingApiKeys(models, new Map(settingsEntries)));
    }
  }, [models]);

  useEffect(() => {
    void syncStatus();

    const handleStatusRefresh = () => {
      void syncStatus();
    };

    window.addEventListener("focus", handleStatusRefresh);
    document.addEventListener("visibilitychange", handleStatusRefresh);
    window.addEventListener("dictateai-settings-changed", handleStatusRefresh);

    return () => {
      window.removeEventListener("focus", handleStatusRefresh);
      document.removeEventListener("visibilitychange", handleStatusRefresh);
      window.removeEventListener("dictateai-settings-changed", handleStatusRefresh);
    };
  }, [syncStatus]);

  const isReady = microphoneGranted && accessibilityGranted;
  const footerStatus = missingApiKeys ? "api" : isReady ? "ready" : "permissions";
  const footerLabel =
    footerStatus === "ready"
      ? t("statusReady")
      : footerStatus === "api"
        ? t("statusApiKeyMissing")
        : t("statusPermissionNeeded");
  const footerDescription =
    footerStatus === "ready"
      ? t("statusReadyDesc")
      : footerStatus === "api"
        ? t("statusApiKeyMissingDesc")
        : t("statusPermissionNeededDesc");

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-[#E5E5E5] font-sans selection:bg-blue-500/30 selection:text-blue-200">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#0F0F0F]">
        <div className="flex items-center gap-3 p-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]">
            <Mic2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">DictateAI</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 transition-all duration-200",
                  isActive
                    ? "bg-white/[0.05] text-white"
                    : "text-neutral-500 hover:bg-white/[0.02] hover:text-neutral-300",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      "h-4 w-4",
                      isActive ? "text-blue-500" : "group-hover:text-neutral-300",
                    )}
                  />
                  <span className="text-sm font-medium">{item.label}</span>
                  {isActive ? (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute left-0 h-4 w-0.5 rounded-full bg-blue-500"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3 px-2 py-2">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                footerStatus === "ready"
                  ? "bg-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.5)]"
                  : "bg-neutral-500 shadow-[0_0_8px_rgba(115,115,115,0.35)]",
              )}
            />
            <span className="text-xs font-medium uppercase tracking-widest text-neutral-400">
              {footerLabel}
            </span>
          </div>
          <p className="px-2 text-[11px] leading-relaxed text-neutral-500">
            {footerDescription}
          </p>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#0A0A0A]">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative min-h-full"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-48 [background-image:radial-gradient(circle,rgba(255,255,255,0.2)_1.1px,transparent_1.1px)] [background-size:19px_19px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-black/18"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.045),transparent_68%)]"
            />
            <div className="relative z-10 mx-auto max-w-4xl p-12">
              <Outlet />
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

    </div>
  );
};

function hasMissingApiKeys(models: ModelsState, settings: Map<string, string>) {
  return !hasSpeechApiKey(models, settings) || !hasRewriteApiKey(models, settings);
}

function hasSpeechApiKey(models: ModelsState, settings: Map<string, string>) {
  switch (models.speechProvider) {
    case "Deepgram":
      return Boolean(settings.get("speech_deepgram_api_key")?.trim());
    case "Google":
      return Boolean(
        settings.get("speech_google_api_key")?.trim()
          && settings.get("speech_google_project_id")?.trim(),
      );
    case "OpenAI":
      return Boolean(settings.get("speech_openai_api_key")?.trim());
    case "Alibaba":
      return Boolean(settings.get("alibaba_api_key")?.trim());
  }
}

function hasRewriteApiKey(models: ModelsState, settings: Map<string, string>) {
  switch (models.rewriteProvider) {
    case "OpenAI":
      return Boolean(settings.get("speech_openai_api_key")?.trim());
    case "Google":
      return Boolean(settings.get("gemini_api_key")?.trim());
    case "Alibaba":
      return Boolean(settings.get("alibaba_api_key")?.trim());
  }
}
