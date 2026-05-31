import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accessibility,
  BookText,
  Check,
  ClipboardPaste,
  Hand,
  Keyboard,
  Lock,
  Mic,
  MousePointerClick,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import {
  checkAccessibility,
  promptAccessibilityPermission,
  promptMicrophonePermission,
} from "../../lib/commands";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { formatHotkeyToken, getMicrophonePermissionState, type MicrophonePermissionState } from "../../lib/ui";

/**
 * Settings → General. Matches the design file's `general:` panel:
 *   Group "Permissions": Microphone row, Accessibility row.
 *   Group "Preferences": Global hotkey row, Trigger mode row, Auto-paste row.
 * Permission controls render as a `.btn.btn-static` (✓ Enabled) when granted,
 * or a `.btn.btn-ai` (↗ Action needed) when the user still needs to grant it.
 * Trigger mode uses the compact `.hero-mode` pill toggle (not large tiles).
 */
export const Home = () => {
  const { t } = useI18n();
  const { hotkeySettings, setHotkeySettings } = useAppStore();
  const [micPerm, setMicPerm] = useState<MicrophonePermissionState>("unknown");
  const [axEnabled, setAxEnabled] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const sync = useCallback(async () => {
    const [m, a] = await Promise.all([
      getMicrophonePermissionState(),
      checkAccessibility().catch(() => null),
    ]);
    setMicPerm(m);
    setAxEnabled(a);
  }, []);

  useEffect(() => {
    void sync();
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [sync]);

  const grant = async (kind: "mic" | "ax") => {
    if (kind === "mic") {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach((track) => track.stop());
      }
      await promptMicrophonePermission().catch(() => undefined);
    } else {
      await promptAccessibilityPermission().catch(() => undefined);
    }
    await sync();
  };

  const captureHotkey = () => {
    setRecording(true);
    toast.info(t("pressShortcutToast"));

    // Tracks a pending bare-modifier press so we can distinguish "user
    // tapped right-Option to use it alone as the hotkey" from "user
    // pressed right-Option as part of a combo and will hit a key next".
    // Only right-Option is supported as a modifier-only hotkey; left-Option
    // is needed for character input (option-L → ¬, etc.) so we don't offer
    // it as a binding.
    let modifierOnlyCandidate: string | null = null;

    const commit = (hotkey: string) => {
      void setHotkeySettings({ hotkey });
      toast.info(t("hotkeyUpdatedToast"));
      cleanup();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      const parts: string[] = [];
      if (event.metaKey || event.ctrlKey) parts.push("⌘");
      if (event.altKey) parts.push("⌥");
      if (event.shiftKey) parts.push("Shift");
      const keyToken = formatHotkeyToken(event.code, event.key);

      if (!keyToken) {
        // Bare modifier press. Mark right-Option as a candidate and wait
        // for its keyup to confirm the user wants it alone.
        if (event.code === "AltRight" && parts.length === 1 && parts[0] === "⌥") {
          modifierOnlyCandidate = "Right Option";
        }
        return;
      }

      // Regular key pressed — drop any modifier-only candidate and commit
      // the combo as before. parts.length === 0 means "no modifier held,
      // user pressed a bare letter" which we still reject as ambiguous.
      modifierOnlyCandidate = null;
      if (parts.length === 0) return;
      parts.push(keyToken);
      commit(parts.join(" + "));
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // User released right-Option without pressing anything else →
      // commit the modifier-only binding.
      if (modifierOnlyCandidate && event.code === "AltRight") {
        commit(modifierOnlyCandidate);
        return;
      }
      // Any other keyup voids the candidate (e.g. user released right-
      // Option but pressed Cmd+A immediately after — that's a combo).
      if (event.code !== "AltRight") {
        modifierOnlyCandidate = null;
      }
    };

    const cleanup = () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecording(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    timeoutRef.current = window.setTimeout(cleanup, 5000);
  };

  const micGranted = micPerm === "granted";
  const axGranted = axEnabled === true;
  // "Right Option" is a special sentinel for the modifier-only macOS path;
  // display it as the single ⌥R token rather than trying to split on "+".
  const isRightOption = hotkeySettings.hotkey.trim().toLowerCase() === "right option";
  const hotkeyTokens = isRightOption
    ? ["⌥R"]
    : hotkeySettings.hotkey
        .split("+")
        .map((s) => s.trim())
        .filter(Boolean);

  return (
    <div>
      {/* Group: Permissions */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">{t("permissionsTitle")}</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Mic strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("microphoneLabel")}</div>
            <div className="s-desc">{t("micPermissionDesc")}</div>
          </div>
          <div className="s-control">
            <PermissionAction granted={micGranted} onGrant={() => void grant("mic")} />
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Accessibility strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("accessibilityLabel")}</div>
            <div className="s-desc">{t("accessibilityPermissionDesc")}</div>
          </div>
          <div className="s-control">
            <PermissionAction granted={axGranted} onGrant={() => void grant("ax")} />
          </div>
        </div>
      </div>

      {/* Group: Preferences */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">{t("preferencesTitle")}</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Keyboard strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("globalHotkey")}</div>
            <div className="s-desc">{t("hotkeySectionDescription")}</div>
          </div>
          <div className="s-control">
            <div className="field-row">
              {hotkeyTokens.length > 0 && (
                <div className="kbd-display">
                  {hotkeyTokens.map((token, i) => (
                    <span key={i} className="kbd-key">
                      {token}
                    </span>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={captureHotkey}
                disabled={recording}
                className="btn"
              >
                <Pencil strokeWidth={2} />
                {recording ? t("pressKeysLabel") : t("changeLabel")}
              </button>
            </div>
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Hand strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("triggerModeLabel")}</div>
            <div className="s-desc">{t("triggerModeDesc")}</div>
          </div>
          <div className="s-control">
            <div className="hero-mode" role="group" aria-label={t("triggerModeLabel") || "Trigger mode"}>
              <button
                type="button"
                className={hotkeySettings.mode === "hold" ? "active" : ""}
                onClick={() => void setHotkeySettings({ mode: "hold" })}
              >
                <Hand strokeWidth={2} />
                <span>{t("holdLabel")}</span>
              </button>
              <button
                type="button"
                className={hotkeySettings.mode === "toggle" ? "active" : ""}
                onClick={() => void setHotkeySettings({ mode: "toggle" })}
              >
                <MousePointerClick strokeWidth={2} />
                <span>{t("tapLabel")}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <ClipboardPaste strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("autoPaste")}</div>
            <div className="s-desc">{t("autoPasteSettingDescription")}</div>
          </div>
          <div className="s-control">
            <button
              type="button"
              aria-pressed={hotkeySettings.autoPaste}
              className={`toggle ${hotkeySettings.autoPaste ? "on" : ""}`}
              onClick={() => {
                const next = !hotkeySettings.autoPaste;
                void setHotkeySettings({ autoPaste: next });
                toast.info(next ? t("autoPasteEnabledToast") : t("autoPasteDisabledToast"));
              }}
            />
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <BookText strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Auto-add vocabulary</div>
            <div className="s-desc">
              When you edit a dictation, offer to add new proper nouns to your vocabulary.
            </div>
          </div>
          <div className="s-control">
            <button
              type="button"
              aria-pressed={hotkeySettings.autoAddVocabulary}
              className={`toggle ${hotkeySettings.autoAddVocabulary ? "on" : ""}`}
              onClick={() => {
                const next = !hotkeySettings.autoAddVocabulary;
                void setHotkeySettings({ autoAddVocabulary: next });
                toast.info(
                  next
                    ? "Auto-add vocabulary on. We'll prompt for new terms after edits."
                    : "Auto-add vocabulary off. No more prompts after edits.",
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

function PermissionAction({ granted, onGrant }: { granted: boolean; onGrant: () => void }) {
  const { t } = useI18n();
  if (granted) {
    return (
      <button type="button" className="btn btn-static">
        <Check strokeWidth={2} />
        {t("permissionEnabledDescription")}
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-ai" onClick={onGrant}>
      <Lock strokeWidth={2} />
      {t("actionNeededLabel")}
    </button>
  );
}
