import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update as TauriUpdate } from "@tauri-apps/plugin-updater";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownRight, DownloadCloud, Hand, Keyboard, Mic, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import {
  checkAccessibility,
  promptAccessibilityPermission,
  promptMicrophonePermission,
} from "../../lib/commands";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { formatHotkeyToken, getMicrophonePermissionState, type MicrophonePermissionState } from "../../lib/ui";
import { cn } from "../../lib/utils";

export const Home = () => {
  const { t } = useI18n();
  const { hotkeySettings, setHotkeySettings } = useAppStore();
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>("unknown");
  const [accessibilityEnabled, setAccessibilityEnabled] = useState<boolean | null>(null);
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>("1.0.5");
  const [availableUpdate, setAvailableUpdate] = useState<TauriUpdate | null>(null);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const syncPermissions = useCallback(async () => {
    const [nextMicrophone, nextAccessibility] = await Promise.all([
      getMicrophonePermissionState(),
      checkAccessibility().catch(() => null),
    ]);

    setMicrophonePermission(nextMicrophone);
    setAccessibilityEnabled(nextAccessibility);
  }, []);

  useEffect(() => {
    void syncPermissions();

    const handleFocus = () => {
      void syncPermissions();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [syncPermissions]);

  useEffect(() => {
    void getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion(t("version").replace(/^v/, "")));
  }, [t]);

  useEffect(() => {
    return () => {
      if (availableUpdate) {
        void availableUpdate.close().catch(() => undefined);
      }
    };
  }, [availableUpdate]);

  const requestPermission = async (kind: "microphone" | "accessibility") => {
    const alreadyEnabled =
      kind === "microphone"
        ? microphonePermission === "granted"
        : accessibilityEnabled === true;

    if (alreadyEnabled) {
      return;
    }

    if (kind === "microphone") {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach((track) => track.stop());
      }

      await promptMicrophonePermission().catch(() => undefined);
    } else {
      await promptAccessibilityPermission().catch(() => undefined);
    }

    await syncPermissions();
  };

  const handleRecordHotkey = () => {
    setIsRecordingHotkey(true);
    toast.info(t("pressShortcutToast"));

    const handler = (event: KeyboardEvent) => {
      event.preventDefault();

      const parts: string[] = [];
      if (event.metaKey || event.ctrlKey) parts.push("⌘");
      if (event.altKey) parts.push("⌥");
      if (event.shiftKey) parts.push("Shift");

      const keyToken = formatHotkeyToken(event.code, event.key);
      if (keyToken) {
        parts.push(keyToken);
      }

      if (parts.length === 0 || !keyToken) {
        return;
      }

      const nextHotkey = parts.join(" + ");
      void setHotkeySettings({ hotkey: nextHotkey });
      toast.info(t("hotkeyUpdatedToast"));
      cleanup(handler);
    };

    const cleanup = (handlerToRemove: (event: KeyboardEvent) => void) => {
      window.removeEventListener("keydown", handlerToRemove);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setIsRecordingHotkey(false);
    };

    window.addEventListener("keydown", handler);
    timeoutRef.current = window.setTimeout(() => cleanup(handler), 5000);
  };

  const microphoneEnabled = microphonePermission === "granted";
  const accessibilityGranted = accessibilityEnabled === true;
  const handleAutoPasteToggle = () => {
    const nextValue = !hotkeySettings.autoPaste;
    void setHotkeySettings({ autoPaste: nextValue });
    toast.info(nextValue ? t("autoPasteEnabledToast") : t("autoPasteDisabledToast"));
  };

  const handleModeChange = (mode: "hold" | "toggle") => {
    if (hotkeySettings.mode === mode) {
      return;
    }

    void setHotkeySettings({ mode });
    toast.info(
      mode === "hold" ? t("holdToDictateEnabledToast") : t("tapToDictateEnabledToast"),
    );
  };

  const handleCheckForUpdates = async () => {
    if (isCheckingForUpdates || isInstallingUpdate) {
      return;
    }

    setIsCheckingForUpdates(true);
    setDownloadProgress(null);

    try {
      const nextUpdate = await check();

      if (!nextUpdate) {
        if (availableUpdate) {
          await availableUpdate.close().catch(() => undefined);
        }
        setAvailableUpdate(null);
        toast.info(t("appUpToDateToast"));
        return;
      }

      if (availableUpdate && availableUpdate !== nextUpdate) {
        await availableUpdate.close().catch(() => undefined);
      }

      setAvailableUpdate(nextUpdate);
      toast.info(t("updateAvailableToast", { version: nextUpdate.version }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToCheckForUpdates"));
    } finally {
      setIsCheckingForUpdates(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate || isInstallingUpdate) {
      return;
    }

    setIsInstallingUpdate(true);
    setDownloadProgress(0);

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;

      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setDownloadProgress(totalBytes > 0 ? 0 : null);
          return;
        }

        if (event.event === "Progress" && totalBytes > 0) {
          downloadedBytes += event.data.chunkLength;
          setDownloadProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
          return;
        }

        if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });

      toast.info(t("restartingToApplyUpdateToast"));
      await availableUpdate.close().catch(() => undefined);
      setAvailableUpdate(null);
      await relaunch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToInstallUpdate"));
    } finally {
      setIsInstallingUpdate(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">{t("navHome")}</h1>
        <p className="text-neutral-400">{t("homeSubtitle")}</p>
      </header>

      <div className="grid gap-x-4 gap-y-8 md:grid-cols-2">
        <PermissionCard
          icon={
            <Mic
              className={cn(
                "h-5 w-5",
                microphoneEnabled ? "text-blue-500" : "text-neutral-400",
              )}
            />
          }
          label={t("microphoneLabel")}
          description={
            microphoneEnabled ? t("permissionEnabledDescription") : t("permissionTapToEnableDescription")
          }
          accent="blue"
          actionable={!microphoneEnabled}
          onClick={() => void requestPermission("microphone")}
        />
        <PermissionCard
          icon={
            <CornerDownRight
              className={cn(
                "h-5 w-5",
                accessibilityGranted ? "text-blue-500" : "text-neutral-400",
              )}
            />
          }
          label={t("accessibilityLabel")}
          description={
            accessibilityGranted ? t("permissionEnabledDescription") : t("permissionTapToEnableDescription")
          }
          accent="blue"
          actionable={!accessibilityGranted}
          onClick={() => void requestPermission("accessibility")}
        />
      </div>

      <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-[#121212] p-8">
        <div className="flex items-center gap-3 border-b border-white/[0.06] pb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <DownloadCloud className="h-5 w-5 text-blue-500" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-white">{t("updatesTitle")}</h2>
            <p className="text-sm text-neutral-500">
              {t("updatesDescription")}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
              {t("currentVersionLabel")}
            </p>
            <p className="text-lg font-semibold text-white">v{currentVersion}</p>
            <p className="text-sm text-neutral-500">
              {availableUpdate
                ? t("updateAvailableDescription", { version: availableUpdate.version })
                : t("updatesReadyDescription", { version: currentVersion })}
            </p>
            {isInstallingUpdate && downloadProgress !== null ? (
              <p className="text-xs font-medium text-blue-400">
                {t("downloadingUpdateProgress", { progress: downloadProgress })}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void (availableUpdate ? handleInstallUpdate() : handleCheckForUpdates())}
            disabled={isCheckingForUpdates || isInstallingUpdate}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold transition-all",
              isCheckingForUpdates || isInstallingUpdate
                ? "cursor-wait bg-white/[0.08] text-neutral-400"
                : "bg-blue-600 text-white shadow-[0_0_18px_rgba(37,99,235,0.28)] hover:bg-blue-500",
            )}
          >
            {isInstallingUpdate
              ? t("installingUpdateButton")
              : isCheckingForUpdates
                ? t("checkingForUpdatesButton")
                : availableUpdate
                  ? t("installUpdateButton")
                  : t("checkForUpdatesButton")}
          </button>
        </div>
      </section>

      <section className="space-y-8 rounded-2xl border border-white/[0.06] bg-[#121212] p-8">
        <div className="flex items-center gap-3 border-b border-white/[0.06] pb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <Keyboard className="h-5 w-5 text-blue-500" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-white">{t("globalHotkey")}</h2>
            <p className="text-sm text-neutral-500">
              {t("hotkeySectionDescription")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-sm font-medium uppercase tracking-widest text-neutral-400">
            {t("desktopShortcutLabel")}
          </label>
          <div
            className={cn(
              "flex items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-all duration-300",
              isRecordingHotkey
                ? "scale-[1.02] border-blue-500 bg-blue-500/5 shadow-[0_0_30px_rgba(37,99,235,0.15)]"
                : "border-white/[0.1] bg-white/[0.02] hover:border-white/[0.2]",
            )}
          >
            <div className="space-y-4 text-center">
              <AnimatePresence mode="wait">
                {isRecordingHotkey ? (
                  <motion.div
                    key="recording"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="text-3xl font-bold tracking-wider text-blue-500"
                  >
                    {t("recordingLabel")}
                  </motion.div>
                ) : (
                  <motion.div
                    key="static"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex flex-wrap items-center justify-center gap-2"
                  >
                    {hotkeySettings.hotkey.split(" + ").map((key) => (
                      <div
                        key={key}
                        className="flex min-w-[60px] items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.05] px-5 py-3 text-2xl font-bold text-white shadow-xl"
                      >
                        {key}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                onClick={handleRecordHotkey}
                disabled={isRecordingHotkey}
                className="mx-auto flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.05] px-6 py-2 text-sm font-medium text-white transition-all hover:bg-white/[0.1]"
              >
                <Keyboard className="h-4 w-4" />
                {t("recordNewHotkeyLabel")}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-x-4 gap-y-8 md:grid-cols-2">
          <ModeCard
            icon={Hand}
            label={t("holdToDictateLabel")}
            description={t("holdToDictateDescription")}
            active={hotkeySettings.mode === "hold"}
            onClick={() => handleModeChange("hold")}
          />
          <ModeCard
            icon={MousePointerClick}
            label={t("tapToDictateLabel")}
            description={t("tapToDictateDescription")}
            active={hotkeySettings.mode === "toggle"}
            onClick={() => handleModeChange("toggle")}
          />
        </div>

        <div className="flex items-center justify-between gap-6 border-t border-white/[0.06] pt-8">
          <div className="space-y-1">
            <p className="text-sm font-medium text-white">{t("autoPaste")}</p>
            <p className="text-xs text-neutral-500">
              {t("autoPasteSettingDescription")}
            </p>
          </div>
          <button
            onClick={handleAutoPasteToggle}
            className={cn(
              "h-6 w-12 shrink-0 rounded-full p-1 transition-all duration-300",
              hotkeySettings.autoPaste
                ? "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                : "bg-white/[0.1]",
            )}
          >
            <div
              className={cn(
                "h-4 w-4 rounded-full bg-white transition-all duration-300",
                hotkeySettings.autoPaste ? "translate-x-6" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </section>
    </div>
  );
};

const PermissionCard = ({
  icon,
  label,
  description,
  accent,
  actionable,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  accent: "blue" | "neutral";
  actionable: boolean;
  onClick: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={actionable ? onClick : undefined}
        className={cn(
          "rounded-2xl border p-6 text-left transition-all",
          actionable
          ? "border-white/[0.08] bg-[#121212] hover:border-white/[0.16] hover:bg-[#171717]"
          : "cursor-default border-white/[0.06] bg-[#121212]",
        )}
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "rounded-xl p-3",
            actionable
              ? "bg-white/[0.05] text-neutral-400"
              : accent === "blue"
                ? "bg-blue-500/10 text-blue-400"
                : "bg-white/[0.05] text-neutral-300",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-lg font-semibold text-white">{label}</div>
          <p className="text-sm leading-relaxed text-neutral-500">{description}</p>
        </div>
      </div>
    </button>
  );
};

const ModeCard = ({
  icon: Icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "rounded-xl border p-5 text-left transition-all",
      active
        ? "border-white/[0.1] bg-[#171717]"
        : "border-white/[0.04] bg-[#121212] hover:bg-[#171717]",
    )}
  >
    <div className="mb-3 flex items-center gap-3">
      <div
        className={cn(
          "rounded-lg p-2",
          active ? "bg-blue-500/10 text-blue-400" : "bg-white/[0.04] text-neutral-400",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-sm font-medium text-white">{label}</span>
    </div>
    <p className="text-sm leading-relaxed text-neutral-500">{description}</p>
  </button>
);
