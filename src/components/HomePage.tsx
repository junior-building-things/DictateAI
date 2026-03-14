import { type ReactNode, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  checkAccessibility,
  getHistory,
  getSetting,
  promptAccessibilityPermission,
  promptMicrophonePermission,
  saveSetting,
  startManualRecording,
  stopManualRecording,
} from "../lib/commands";
import { getLanguageOptions, type LanguageCode, useI18n } from "../lib/i18n";
import { getMicrophonePermissionState, type MicrophonePermissionState } from "../lib/ui";
import { CpuIcon, GlobeIcon, KeyboardIcon, MicIcon, ShieldIcon } from "./AppIcons";

const APP_LANGUAGES = getLanguageOptions();
const SCRATCHPAD_STORAGE_KEY = "dictateai-desktop-scratchpad";

type AppStatus = "idle" | "recording" | "processing";
type DictationResult = {
  original: string;
  rewritten: string;
};

export default function HomePage({ appState }: { appState: AppStatus }) {
  const { language, setLanguage } = useI18n();
  const [hotkey, setHotkey] = useState("CommandOrControl+S");
  const [spokenLanguage, setSpokenLanguage] = useState("en");
  const [translationLanguage, setTranslationLanguage] = useState("same");
  const [microphoneState, setMicrophoneState] =
    useState<MicrophonePermissionState>("unknown");
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [lastResult, setLastResult] = useState<DictationResult | null>(null);
  const [scratchpad, setScratchpad] = useState(() => {
    try {
      return localStorage.getItem(SCRATCHPAD_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [notice, setNotice] = useState<string>("");

  useEffect(() => {
    try {
      localStorage.setItem(SCRATCHPAD_STORAGE_KEY, scratchpad);
    } catch {
      // Ignore local storage issues in dev mode.
    }
  }, [scratchpad]);

  useEffect(() => {
    const load = async () => {
      const [
        nextHotkey,
        nextSpokenLanguage,
        nextTranslationLanguage,
        [, total],
        nextAccessibility,
        nextMicrophone,
      ] = await Promise.all([
        getSetting("hotkey").catch(() => "CommandOrControl+S"),
        getSetting("language").catch(() => "en"),
        getSetting("translation_language").catch(() => "same"),
        getHistory(0, 1).catch(() => [[], 0] as const),
        checkAccessibility().catch(() => null),
        getMicrophonePermissionState(),
      ]);

      setHotkey(nextHotkey);
      setSpokenLanguage(nextSpokenLanguage);
      setTranslationLanguage(nextTranslationLanguage);
      setHistoryTotal(total);
      setAccessibilityGranted(nextAccessibility);
      setMicrophoneState(nextMicrophone);
    };

    void load();
  }, []);

  useEffect(() => {
    const syncPermissions = () => {
      void Promise.all([
        checkAccessibility().catch(() => null),
        getMicrophonePermissionState(),
      ]).then(([nextAccessibility, nextMicrophone]) => {
        setAccessibilityGranted(nextAccessibility);
        setMicrophoneState(nextMicrophone);
      });
    };

    syncPermissions();
    window.addEventListener("focus", syncPermissions);
    document.addEventListener("visibilitychange", syncPermissions);

    return () => {
      window.removeEventListener("focus", syncPermissions);
      document.removeEventListener("visibilitychange", syncPermissions);
    };
  }, []);

  useEffect(() => {
    let currentOriginal = "";

    const subscriptions = Promise.all([
      listen<string>("transcription-complete", (event) => {
        currentOriginal = event.payload;
        setLastResult((previous) => ({
          original: event.payload,
          rewritten: previous?.rewritten ?? "",
        }));
      }),
      listen<string>("pipeline-complete", async (event) => {
        setLastResult({
          original: currentOriginal,
          rewritten: event.payload,
        });
        const [, total] = await getHistory(0, 1).catch(() => [[], 0] as const);
        setHistoryTotal(total);
        setNotice("Dictation complete.");
      }),
    ]);

    return () => {
      void subscriptions.then((unsubscribers) => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      });
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const handlePermissionAction = async (kind: "microphone" | "accessibility") => {
    if (kind === "microphone") {
      if (microphoneState === "prompt") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach((track) => track.stop());
      }
      await promptMicrophonePermission().catch(() => undefined);
      const nextState = await getMicrophonePermissionState();
      setMicrophoneState(nextState);
      return;
    }

    await promptAccessibilityPermission().catch(() => undefined);
    const nextAccessibility = await checkAccessibility().catch(() => null);
    setAccessibilityGranted(nextAccessibility);
  };

  const handleMainAction = async () => {
    setNotice("");

    if (appState === "recording") {
      await stopManualRecording().catch((error) => {
        setNotice(normalizeError(error, "Unable to stop recording."));
      });
      return;
    }

    if (appState === "processing") {
      return;
    }

    await startManualRecording().catch((error) => {
      setNotice(normalizeError(error, "Unable to start recording."));
    });
  };

  const handleCopy = async () => {
    if (!lastResult?.rewritten) {
      return;
    }

    await writeText(lastResult.rewritten).catch(() => undefined);
    setNotice("Copied to clipboard.");
  };

  const handleInsert = () => {
    if (!lastResult?.rewritten) {
      return;
    }

    setScratchpad((current) =>
      current.trim() ? `${current.trimEnd()}\n${lastResult.rewritten}` : lastResult.rewritten
    );
    setNotice("Inserted into scratchpad.");
  };

  const handleSpokenLanguageChange = async (value: string) => {
    setSpokenLanguage(value);
    await saveSetting("language", value).catch(() => undefined);
  };

  const handleTranslationLanguageChange = async (value: string) => {
    setTranslationLanguage(value);
    await saveSetting("translation_language", value).catch(() => undefined);
  };

  const microphoneReady = microphoneState === "granted";
  const accessibilityReady = accessibilityGranted === true;
  const currentHint =
    appState === "recording"
      ? "Release or press again to stop recording."
      : appState === "processing"
        ? "Processing the captured audio through the desktop pipeline."
        : `Use ${formatHotkey(hotkey)} or click the button to start dictation.`;

  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
          DictateAI
        </h1>
        <p className="max-w-3xl text-sm leading-7 text-neutral-400 md:text-base">
          Global-hotkey dictation, rewrite, clipboard, and overlay status are all running in the
          Tauri desktop runtime. This is the v2 shell wired to the real app.
        </p>
      </header>

      {notice ? (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] px-4 py-3 text-sm text-cyan-200">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          icon={<MicIcon className="h-4 w-4" />}
          label="Microphone"
          value={microphoneReady ? "Granted" : formatPermission(microphoneState)}
          detail="Required for recording."
          accent={microphoneReady ? "good" : "warn"}
          onClick={!microphoneReady ? () => void handlePermissionAction("microphone") : undefined}
        />
        <StatusCard
          icon={<ShieldIcon className="h-4 w-4" />}
          label="Accessibility"
          value={accessibilityReady ? "Granted" : "Needs attention"}
          detail="Required for auto-paste."
          accent={accessibilityReady ? "good" : "warn"}
          onClick={
            !accessibilityReady ? () => void handlePermissionAction("accessibility") : undefined
          }
        />
        <StatusCard
          icon={<KeyboardIcon className="h-4 w-4" />}
          label="Hotkey"
          value={formatHotkey(hotkey)}
          detail="Press and hold to dictate."
          accent="neutral"
        />
        <StatusCard
          icon={<CpuIcon className="h-4 w-4" />}
          label="Pipeline"
          value="API"
          detail={`${historyTotal} run${historyTotal === 1 ? "" : "s"} in history`}
          accent="accent"
        />
      </section>

      <section className="rounded-[28px] border border-white/[0.06] bg-white/[0.03] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        <div className="relative overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#0f1012] p-8">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative z-10 space-y-6 text-center">
            <button
              type="button"
              onClick={() => void handleMainAction()}
              disabled={appState === "processing"}
              className={[
                "mx-auto flex h-24 w-24 items-center justify-center rounded-full transition",
                appState === "recording"
                  ? "bg-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)]"
                  : appState === "processing"
                    ? "cursor-not-allowed bg-neutral-700"
                    : "bg-cyan-500 text-black shadow-[0_0_36px_rgba(34,211,238,0.28)] hover:bg-cyan-400",
              ].join(" ")}
            >
              <MicIcon className="h-10 w-10" />
            </button>

            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">
                {appState === "recording"
                  ? "Listening..."
                  : appState === "processing"
                    ? "Processing..."
                    : "Start dictation"}
              </h2>
              <p className="text-sm text-neutral-400">{currentHint}</p>
              <p className="text-xs text-neutral-500">
                Audio capture uses the real desktop pipeline, not browser speech recognition.
              </p>
            </div>
          </div>

          {lastResult ? (
            <div className="relative z-10 mt-8 space-y-5 border-t border-white/[0.06] pt-8">
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-500">
                  Spoken
                </div>
                <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-4 text-sm text-neutral-300">
                  {lastResult.original}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">
                  Rewritten output
                </div>
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4 text-sm font-medium text-white">
                  {lastResult.rewritten}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setLastResult(null)}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.06]"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-neutral-300 transition hover:bg-white/[0.06]"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={handleInsert}
                  className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400"
                >
                  Insert into scratchpad
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300">
              <GlobeIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
                Language controls
              </div>
              <h2 className="text-xl font-semibold text-white">Speech and output languages</h2>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                App language
              </label>
              <select
                value={language}
                onChange={(event) => {
                  void setLanguage(event.target.value as LanguageCode);
                }}
                className="input-control"
              >
                {APP_LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                Spoken language
              </label>
              <select
                value={spokenLanguage}
                onChange={(event) => {
                  void handleSpokenLanguageChange(event.target.value);
                }}
                className="input-control"
              >
                {APP_LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                Output language
              </label>
              <select
                value={translationLanguage}
                onChange={(event) => {
                  void handleTranslationLanguageChange(event.target.value);
                }}
                className="input-control"
              >
                <option value="same">Same as spoken language</option>
                {APP_LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
              Scratchpad
            </div>
            <h2 className="text-xl font-semibold text-white">Drop the result somewhere editable</h2>
            <p className="text-sm leading-7 text-neutral-400">
              The real desktop app auto-pastes when accessibility is granted. This scratchpad is
              still useful for quick testing and comparing outputs.
            </p>
          </div>

          <textarea
            value={scratchpad}
            onChange={(event) => setScratchpad(event.target.value)}
            className="input-control mt-5 min-h-72 resize-y p-4 text-sm leading-7 text-neutral-200"
            placeholder="Use this space to test inserted text."
          />
        </div>
      </section>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  accent,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  accent: "good" | "warn" | "neutral" | "accent";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-[22px] border p-5 text-left shadow-[0_18px_50px_rgba(0,0,0,0.22)] transition",
        "bg-white/[0.03]",
        accent === "good"
          ? "border-emerald-500/20"
          : accent === "warn"
            ? "border-amber-500/20"
            : accent === "accent"
              ? "border-cyan-500/20"
              : "border-white/[0.06]",
        onClick ? "hover:bg-white/[0.05]" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-4">
        <div
          className={[
            "rounded-xl p-2",
            accent === "good"
              ? "bg-emerald-500/10 text-emerald-300"
              : accent === "warn"
                ? "bg-amber-500/10 text-amber-300"
                : accent === "accent"
                  ? "bg-cyan-500/10 text-cyan-300"
                  : "bg-white/[0.05] text-neutral-300",
          ].join(" ")}
        >
          {icon}
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
          {label}
        </span>
      </div>
      <div className="mt-4 text-sm font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs leading-6 text-neutral-500">{detail}</div>
    </button>
  );
}

function formatHotkey(hotkey: string) {
  return hotkey.replaceAll("CommandOrControl", "Cmd/Ctrl").replaceAll("Alt", "Opt");
}

function formatPermission(value: MicrophonePermissionState) {
  if (value === "granted") return "Granted";
  if (value === "denied") return "Denied";
  if (value === "prompt") return "Prompt";
  if (value === "unsupported") return "Unsupported";
  return "Unknown";
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
