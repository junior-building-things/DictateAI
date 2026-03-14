import { checkMicrophonePermission } from "./commands";

export type MicrophonePermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported"
  | "unknown";

export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  try {
    const nativeState = await checkMicrophonePermission();
    if (isMicrophonePermissionState(nativeState)) {
      return nativeState;
    }
  } catch {
    // Fall back to the browser/WebView API below.
  }

  if (typeof navigator === "undefined") {
    return "unsupported";
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }

  if (!navigator.permissions?.query) {
    return "unknown";
  }

  try {
    const result = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });

    return result.state as MicrophonePermissionState;
  } catch {
    return "unknown";
  }
}

function isMicrophonePermissionState(value: string): value is MicrophonePermissionState {
  return ["granted", "denied", "prompt", "unsupported", "unknown"].includes(value);
}

export function formatHotkeyForDisplay(hotkey: string) {
  return hotkey.split("+").map((part) => {
    if (part === "CommandOrControl") return "Cmd/Ctrl";
    if (part === "Alt") return "Opt";
    return part;
  });
}

export function formatHotkeyToken(code: string, key: string): string | null {
  if (code === "Space") return "Space";
  if (code === "Escape") return "Escape";
  if (code === "Enter") return "Enter";
  if (code === "Backspace") return "Backspace";
  if (code === "Delete") return "Delete";
  if (code === "Tab") return null;
  if (code.startsWith("Arrow")) return code.replace("Arrow", "");
  if (/^Key[A-Z]$/i.test(code)) return code.slice(3).toUpperCase();
  if (/^Digit[0-9]$/i.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/i.test(code)) return code.slice(6);
  if (/^F\d{1,2}$/i.test(code)) return code.toUpperCase();
  if (["Shift", "Meta", "Control", "Alt"].includes(key)) return null;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function formatStatusLabel(state: "idle" | "recording" | "processing") {
  if (state === "recording") return "Listening";
  if (state === "processing") return "Processing";
  return "Ready";
}

export function getLocaleTag(language: string) {
  const map: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    ja: "ja-JP",
    zh: "zh-CN",
    sv: "sv-SE",
    fi: "fi-FI",
  };

  return map[language] ?? "en-US";
}
