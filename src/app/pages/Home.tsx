import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accessibility,
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
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      const parts: string[] = [];
      if (event.metaKey || event.ctrlKey) parts.push("⌘");
      if (event.altKey) parts.push("⌥");
      if (event.shiftKey) parts.push("Shift");
      const keyToken = formatHotkeyToken(event.code, event.key);
      if (!keyToken || parts.length === 0) return;
      parts.push(keyToken);
      void setHotkeySettings({ hotkey: parts.join(" + ") });
      toast.info(t("hotkeyUpdatedToast"));
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("keydown", handler);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecording(false);
    };
    window.addEventListener("keydown", handler);
    timeoutRef.current = window.setTimeout(cleanup, 5000);
  };

  const micGranted = micPerm === "granted";
  const axGranted = axEnabled === true;
  const hotkeyTokens = hotkeySettings.hotkey
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div>
      {/* Group: Permissions */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">Permissions</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Mic strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Microphone</div>
            <div className="s-desc">Allow DictateAI to use your microphone for dictation.</div>
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
            <div className="s-label">Accessibility</div>
            <div className="s-desc">Allow DictateAI to use accessibility settings for auto-paste.</div>
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
            <span className="title">Preferences</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Keyboard strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Global hotkey</div>
            <div className="s-desc">Set the hotkey that triggers DictateAI.</div>
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
                {recording ? "Press keys…" : "Change"}
              </button>
            </div>
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Hand strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Trigger mode</div>
            <div className="s-desc">Choose how to trigger the hotkey.</div>
          </div>
          <div className="s-control">
            <div className="hero-mode" role="group" aria-label="Trigger mode">
              <button
                type="button"
                className={hotkeySettings.mode === "hold" ? "active" : ""}
                onClick={() => void setHotkeySettings({ mode: "hold" })}
              >
                <Hand strokeWidth={2} />
                <span>Hold</span>
              </button>
              <button
                type="button"
                className={hotkeySettings.mode === "toggle" ? "active" : ""}
                onClick={() => void setHotkeySettings({ mode: "toggle" })}
              >
                <MousePointerClick strokeWidth={2} />
                <span>Tap</span>
              </button>
            </div>
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <ClipboardPaste strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Auto-paste</div>
            <div className="s-desc">Paste the rewritten text into the focused app when dictation ends.</div>
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
      </div>
    </div>
  );
};

function PermissionAction({ granted, onGrant }: { granted: boolean; onGrant: () => void }) {
  if (granted) {
    return (
      <button type="button" className="btn btn-static">
        <Check strokeWidth={2} />
        Enabled
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-ai" onClick={onGrant}>
      <Lock strokeWidth={2} />
      Action needed
    </button>
  );
}
