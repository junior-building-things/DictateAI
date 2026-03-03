import { useEffect, useState, type KeyboardEvent } from "react";
import {
  checkAccessibility,
  getSetting,
  promptMicrophonePermission,
  promptAccessibilityPermission,
  saveSetting,
  updateHotkey,
} from "../lib/commands";
import { getLanguageOptions, useI18n, type LanguageCode } from "../lib/i18n";

const APP_LANGUAGES = getLanguageOptions();
const TRANSCRIPTION_LANGUAGES: { value: string; label: string }[] = APP_LANGUAGES;
type MicrophonePermissionState = "granted" | "denied" | "prompt" | "unsupported" | "unknown";
type PermissionPanelState = {
  microphone: MicrophonePermissionState;
  accessibility: boolean | null;
};

export default function GeneralSettings() {
  const [loading, setLoading] = useState(true);
  const [hotkey, setHotkey] = useState("");
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [spokenLanguage, setSpokenLanguage] = useState("en");
  const [translationLanguage, setTranslationLanguage] = useState("same");
  const [permissionState, setPermissionState] = useState<PermissionPanelState>({
    microphone: "unknown",
    accessibility: null,
  });
  const { language: interfaceLanguage, setLanguage, t } = useI18n();
  const copy = getGeneralCopy(interfaceLanguage);

  const refreshPermissionState = async () => {
    const [accessibilityGranted, microphoneState] = await Promise.all([
      checkAccessibility().catch(() => null),
      getMicrophonePermissionState(),
    ]);

    setPermissionState({
      accessibility: accessibilityGranted,
      microphone: microphoneState,
    });
  };

  useEffect(() => {
    const load = async () => {
      const [hotkeyValue, spoken, translation] = await Promise.all([
        getSetting("hotkey").catch(() => "CommandOrControl+S"),
        getSetting("language").catch(() => "en"),
        getSetting("translation_language").catch(() => "same"),
      ]);

      setHotkey(hotkeyValue);
      setSpokenLanguage(spoken);
      setTranslationLanguage(translation);
      setLoading(false);
      void refreshPermissionState();
    };

    void load();
  }, []);

  useEffect(() => {
    if (loading) return;

    const refreshIfVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refreshPermissionState();
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loading]);

  const formatKeyToken = (code: string, key: string): string | null => {
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
    if (/^F\\d{1,2}$/i.test(code)) return code.toUpperCase();
    if (["Shift", "Meta", "Control", "Alt"].includes(key)) return null;
    if (key.length === 1) return key.toUpperCase();
    return key;
  };

  const captureHotkey = async (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();

    const keyToken = formatKeyToken(event.code, event.key);
    if (!keyToken) return;

    const parts: string[] = [];
    if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(keyToken);

    const shortcut = parts.join("+");
    setHotkey(shortcut);
    setIsCapturingHotkey(false);
    await updateHotkey(shortcut);
  };

  const requestMicrophonePermission = async (): Promise<MicrophonePermissionState> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return "unsupported";
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      // The user may deny the prompt or the runtime may reject the request.
    }

    const nextState = await getMicrophonePermissionState();
    await refreshPermissionState();
    return nextState;
  };

  const handlePermissionAction = async (kind: "microphone" | "accessibility") => {
    if (kind === "microphone") {
      if (permissionState.microphone === "prompt") {
        const nextState = await requestMicrophonePermission();
        if (nextState === "granted") {
          return;
        }
      }

      await promptMicrophonePermission().catch(() => undefined);
      window.setTimeout(() => {
        void refreshPermissionState();
      }, 600);
      return;
    }

    await promptAccessibilityPermission().catch(() => undefined);
    window.setTimeout(() => {
      void refreshPermissionState();
    }, 600);
  };

  const microphoneStatus = getMicrophoneStatusMeta(permissionState.microphone, copy);
  const accessibilityStatus = getAccessibilityStatusMeta(permissionState.accessibility, copy);
  const microphoneEnabled = microphoneStatus.tone === "good";
  const accessibilityEnabled = accessibilityStatus.tone === "good";
  const showMicrophoneActionNeeded = microphoneStatus.tone === "warn";
  const showAccessibilityActionNeeded = accessibilityStatus.tone === "warn";

  if (loading) return <div className="p-6 text-sm text-neutral-500">{t("loading")}</div>;

  return (
    <section className="space-y-6 p-7">
      <div className="surface-card space-y-4 p-6">
        <div className="space-y-2">
          <div className="section-title">{copy.permissionsTitle}</div>
          <div className="field-help">{copy.permissionsHelp}</div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-neutral-800 bg-black px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-100">{copy.microphoneLabel}</div>
                <div className="mt-1 text-xs leading-5 text-neutral-500">{copy.microphoneDescription}</div>
              </div>
              <div className="flex shrink-0 self-center items-center gap-3">
                {showMicrophoneActionNeeded ? (
                  <div className="text-[11px] font-semibold tracking-[0.06em] text-red-400">
                    {copy.permissionsActionNeededBanner}
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-pressed={microphoneEnabled}
                  aria-label={`${copy.microphoneLabel}: ${microphoneStatus.label}`}
                  onClick={() => void handlePermissionAction("microphone")}
                  className={switchTrackClass(microphoneEnabled, true)}
                >
                  <span className={switchThumbClass(microphoneEnabled)} />
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-black px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-neutral-100">{copy.accessibilityLabel}</div>
                <div className="mt-1 text-xs leading-5 text-neutral-500">{copy.accessibilityDescription}</div>
              </div>
              <div className="flex shrink-0 self-center items-center gap-3">
                {showAccessibilityActionNeeded ? (
                  <div className="text-[11px] font-semibold tracking-[0.06em] text-red-400">
                    {copy.permissionsActionNeededBanner}
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-pressed={accessibilityEnabled}
                  aria-label={`${copy.accessibilityLabel}: ${accessibilityStatus.label}`}
                  onClick={() => void handlePermissionAction("accessibility")}
                  className={switchTrackClass(accessibilityEnabled, true)}
                >
                  <span className={switchThumbClass(accessibilityEnabled)} />
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="surface-card space-y-5 p-6">
        <div className="space-y-2">
          <h3 className="section-title">{copy.hotkeyTitle}</h3>
          <p className="field-help">{copy.hotkeyHelp}</p>
        </div>
        <div>
          <input
            value={isCapturingHotkey ? "" : hotkey}
            readOnly
            onFocus={() => setIsCapturingHotkey(true)}
            onBlur={() => setIsCapturingHotkey(false)}
            onKeyDown={(e) => void captureHotkey(e)}
            placeholder={isCapturingHotkey ? copy.pressAnyKey : t("clickAndPress")}
            className="input-control hotkey-capture-input flex-1"
          />
        </div>
      </div>

      <div className="surface-card space-y-4 p-6">
        <div className="section-title">{t("languageSelection")}</div>

        <label className="field-label block">{t("interfaceLanguage")}</label>
        <select
          value={interfaceLanguage}
          onChange={(e) => {
            const value = e.target.value;
            void setLanguage(value as LanguageCode);
          }}
          className="input-control"
        >
          {APP_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>

        <label className="field-label block">{t("spokenLanguage")}</label>
        <select
          value={spokenLanguage}
          onChange={(e) => {
            const value = e.target.value;
            setSpokenLanguage(value);
            void saveSetting("language", value);
          }}
          className="input-control"
        >
          {TRANSCRIPTION_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>

        <label className="field-label block">{t("translationLanguage")}</label>
        <select
          value={translationLanguage}
          onChange={(e) => {
            const value = e.target.value;
            setTranslationLanguage(value);
            void saveSetting("translation_language", value);
          }}
          className="input-control"
        >
          <option value="same">{t("sameAsSpoken")}</option>
          {TRANSCRIPTION_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
        <p className="field-help">{t("translationHelp")}</p>
      </div>
    </section>
  );
}

async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }

  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }
    return "unknown";
  } catch {
    return "unsupported";
  }
}

function getMicrophoneStatusMeta(
  state: MicrophonePermissionState,
  copy: ReturnType<typeof getGeneralCopy>,
) {
  if (state === "granted") {
    return { label: copy.statusAllowed, tone: "good" as const, actionable: false };
  }
  if (state === "denied") {
    return { label: copy.statusNeedsAction, tone: "warn" as const, actionable: false };
  }
  if (state === "prompt") {
    return { label: copy.statusNeedsAction, tone: "warn" as const, actionable: true };
  }
  if (state === "unsupported") {
    return { label: copy.statusUnknown, tone: "muted" as const, actionable: false };
  }
  return { label: copy.statusChecking, tone: "muted" as const, actionable: false };
}

function getAccessibilityStatusMeta(
  state: boolean | null,
  copy: ReturnType<typeof getGeneralCopy>,
) {
  if (state === true) {
    return { label: copy.statusAllowed, tone: "good" as const, actionable: false };
  }
  if (state === false) {
    return { label: copy.statusNeedsAction, tone: "warn" as const, actionable: true };
  }
  return { label: copy.statusChecking, tone: "muted" as const, actionable: false };
}

function switchTrackClass(enabled: boolean, interactive = false) {
  const interactiveClass = interactive ? " cursor-pointer hover:border-neutral-500" : "";
  return [
    "relative inline-flex h-8 w-14 shrink-0 self-center items-center rounded-full border transition-all",
    enabled ? "border-neutral-200 bg-white" : "border-neutral-700 bg-neutral-900",
    interactiveClass,
  ].join(" ");
}

function switchThumbClass(enabled: boolean) {
  return [
    "inline-block h-6 w-6 rounded-full transition-all",
    enabled ? "translate-x-7 bg-black" : "translate-x-1 bg-neutral-500",
  ].join(" ");
}

function getGeneralCopy(language: LanguageCode) {
  const copy = {
    en: {
      hotkeyTitle: "Hotkey",
      hotkeyHelp:
        "Set your hotkey to trigger dictation. Avoid using Mac/Windows system keys.",
      pressAnyKey: "Press any key",
      permissionsTitle: "Permissions",
      permissionsActionNeededBanner: "Action Needed",
      permissionsHelp: "Current macOS access state for recording and auto-paste.",
      microphoneLabel: "Microphone",
      microphoneDescription: "Required to capture your voice for dictation.",
      accessibilityLabel: "Accessibility",
      accessibilityDescription: "Required to paste automatically into the active app.",
      statusAllowed: "Enabled",
      statusBlocked: "Action needed",
      statusNeedsAction: "Action needed",
      statusChecking: "Checking",
      statusUnknown: "Unknown",
    },
    es: {
      hotkeyTitle: "Atajo",
      hotkeyHelp:
        "Configura tu atajo para activar el dictado. Evita usar teclas del sistema de Mac/Windows.",
      pressAnyKey: "Pulsa cualquier tecla",
      permissionsTitle: "Permisos",
      permissionsActionNeededBanner: "Accion necesaria",
      permissionsHelp: "Estado actual de acceso en macOS para grabacion y pegado automatico.",
      microphoneLabel: "Microfono",
      microphoneDescription: "Necesario para capturar tu voz al dictar.",
      accessibilityLabel: "Accesibilidad",
      accessibilityDescription: "Necesario para pegar automaticamente en la app activa.",
      statusAllowed: "Habilitado",
      statusBlocked: "Accion necesaria",
      statusNeedsAction: "Accion necesaria",
      statusChecking: "Comprobando",
      statusUnknown: "Desconocido",
    },
    fr: {
      hotkeyTitle: "Raccourci",
      hotkeyHelp:
        "Définissez votre raccourci pour lancer la dictée. Évitez d'utiliser les touches système Mac/Windows.",
      pressAnyKey: "Appuyez sur une touche",
      permissionsTitle: "Autorisations",
      permissionsActionNeededBanner: "Action requise",
      permissionsHelp: "Etat actuel de l'acces macOS pour l'enregistrement et le collage automatique.",
      microphoneLabel: "Microphone",
      microphoneDescription: "Necessaire pour capturer votre voix pendant la dictee.",
      accessibilityLabel: "Accessibilite",
      accessibilityDescription: "Necessaire pour coller automatiquement dans l'application active.",
      statusAllowed: "Active",
      statusBlocked: "Action requise",
      statusNeedsAction: "Action requise",
      statusChecking: "Verification",
      statusUnknown: "Inconnu",
    },
    de: {
      hotkeyTitle: "Tastenkürzel",
      hotkeyHelp:
        "Lege dein Tastenkürzel fest, um das Diktat zu starten. Vermeide Mac-/Windows-Systemtasten.",
      pressAnyKey: "Beliebige Taste drücken",
      permissionsTitle: "Berechtigungen",
      permissionsActionNeededBanner: "Aktion noetig",
      permissionsHelp: "Aktueller macOS-Zugriffsstatus fur Aufnahme und automatisches Einfugen.",
      microphoneLabel: "Mikrofon",
      microphoneDescription: "Erforderlich, um deine Stimme fur die Diktierfunktion aufzunehmen.",
      accessibilityLabel: "Bedienungshilfen",
      accessibilityDescription: "Erforderlich, um automatisch in die aktive App einzufugen.",
      statusAllowed: "Aktiviert",
      statusBlocked: "Aktion noetig",
      statusNeedsAction: "Aktion noetig",
      statusChecking: "Wird gepruft",
      statusUnknown: "Unbekannt",
    },
    ja: {
      hotkeyTitle: "ショートカット",
      hotkeyHelp:
        "ディクテーションを開始するショートカットを設定します。Mac/Windows のシステムキーは避けてください。",
      pressAnyKey: "いずれかのキーを押してください",
      permissionsTitle: "アクセス権",
      permissionsActionNeededBanner: "対応が必要",
      permissionsHelp: "録音と自動貼り付けに関する現在の macOS 権限状態です。",
      microphoneLabel: "マイク",
      microphoneDescription: "音声入力を録音するために必要です。",
      accessibilityLabel: "アクセシビリティ",
      accessibilityDescription: "アクティブなアプリへ自動で貼り付けるために必要です。",
      statusAllowed: "有効",
      statusBlocked: "要対応",
      statusNeedsAction: "要対応",
      statusChecking: "確認中",
      statusUnknown: "不明",
    },
    zh: {
      hotkeyTitle: "快捷键",
      hotkeyHelp: "设置用于开始听写的快捷键。避免使用 Mac/Windows 系统键。",
      pressAnyKey: "按任意键",
      permissionsTitle: "权限",
      permissionsActionNeededBanner: "需要处理",
      permissionsHelp: "当前 macOS 对录音和自动粘贴的访问状态。",
      microphoneLabel: "麦克风",
      microphoneDescription: "用于录制你的语音输入。",
      accessibilityLabel: "辅助功能",
      accessibilityDescription: "用于自动粘贴到当前应用。",
      statusAllowed: "已启用",
      statusBlocked: "需要处理",
      statusNeedsAction: "需要处理",
      statusChecking: "检查中",
      statusUnknown: "未知",
    },
    sv: {
      hotkeyTitle: "Snabbtangent",
      hotkeyHelp:
        "Ställ in din snabbtangent för att starta diktering. Undvik att använda Mac/Windows-systemtangenter.",
      pressAnyKey: "Tryck på valfri tangent",
      permissionsTitle: "Behorigheter",
      permissionsActionNeededBanner: "Atgard kravs",
      permissionsHelp: "Aktuell macOS-status for inspelning och automatisk inklistring.",
      microphoneLabel: "Mikrofon",
      microphoneDescription: "Kravs for att spela in din rost for diktering.",
      accessibilityLabel: "Hjalpmedel",
      accessibilityDescription: "Kravs for att klistra in automatiskt i den aktiva appen.",
      statusAllowed: "Aktiverad",
      statusBlocked: "Atgard kravs",
      statusNeedsAction: "Atgard kravs",
      statusChecking: "Kontrollerar",
      statusUnknown: "Okand",
    },
    fi: {
      hotkeyTitle: "Pikanäppäin",
      hotkeyHelp:
        "Aseta pikanäppäin sanelun käynnistämiseen. Vältä Mac/Windows-järjestelmänäppäimiä.",
      pressAnyKey: "Paina mitä tahansa näppäintä",
      permissionsTitle: "Kayttooikeudet",
      permissionsActionNeededBanner: "Toimia tarvitaan",
      permissionsHelp: "Nykyinen macOS-kayttooikeuksien tila nauhoitukselle ja automaattiselle liittamiselle.",
      microphoneLabel: "Mikrofoni",
      microphoneDescription: "Tarvitaan aanesi tallentamiseen sanelua varten.",
      accessibilityLabel: "Kayttoapu",
      accessibilityDescription: "Tarvitaan automaattiseen liittamiseen aktiiviseen sovellukseen.",
      statusAllowed: "Kaytossa",
      statusBlocked: "Toimia tarvitaan",
      statusNeedsAction: "Toimia tarvitaan",
      statusChecking: "Tarkistetaan",
      statusUnknown: "Tuntematon",
    },
  } as const;

  return copy[language] ?? copy.en;
}
