import { useEffect, useState, type KeyboardEvent } from "react";
import { getSetting, saveSetting, updateHotkey } from "../lib/commands";
import { formatHotkeyForDisplay, formatHotkeyToken } from "../lib/ui";
import { KeyboardIcon, ShieldIcon } from "./AppIcons";

export default function HotkeyPage() {
  const [hotkey, setHotkey] = useState("CommandOrControl+S");
  const [autoPaste, setAutoPaste] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    Promise.all([
      getSetting("hotkey").catch(() => "CommandOrControl+S"),
      getSetting("auto_paste").catch(() => "true"),
      getSetting("sound_enabled").catch(() => "true"),
    ]).then(([nextHotkey, nextAutoPaste, nextSoundEnabled]) => {
      setHotkey(nextHotkey);
      setAutoPaste(nextAutoPaste === "true");
      setSoundEnabled(nextSoundEnabled === "true");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const captureHotkey = async (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();

    const keyToken = formatHotkeyToken(event.code, event.key);
    if (!keyToken) return;

    const parts: string[] = [];
    if (event.metaKey || event.ctrlKey) parts.push("CommandOrControl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(keyToken);

    const shortcut = parts.join("+");
    setHotkey(shortcut);
    setIsCapturing(false);

    await updateHotkey(shortcut)
      .then(() => setNotice("Hotkey updated."))
      .catch((error) => setNotice(normalizeError(error, "Unable to update hotkey.")));
  };

  const toggleSetting = async (key: "auto_paste" | "sound_enabled", nextValue: boolean) => {
    await saveSetting(key, nextValue ? "true" : "false")
      .then(() => setNotice("Setting saved."))
      .catch((error) => setNotice(normalizeError(error, "Unable to save setting.")));
  };

  if (loading) {
    return <div className="px-12 py-14 text-sm text-neutral-500">Loading...</div>;
  }

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
          Hotkey Settings
        </h1>
        <p className="max-w-2xl text-sm leading-7 text-neutral-400 md:text-base">
          DictateAI listens globally through Tauri. Hold the shortcut to record, then release to
          trigger transcription and rewrite.
        </p>
      </header>

      {notice ? (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] px-4 py-3 text-sm text-cyan-200">
          {notice}
        </div>
      ) : null}

      <section className="rounded-[28px] border border-white/[0.06] bg-white/[0.03] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        <div className="mb-8 flex items-center gap-4">
          <div className="rounded-2xl bg-cyan-500/10 p-3 text-cyan-300">
            <KeyboardIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Primary shortcut</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Click the field and press the exact key combination you want to register globally.
            </p>
          </div>
        </div>

        <div className="rounded-[24px] border-2 border-dashed border-white/[0.1] bg-black/35 p-8 text-center transition focus-within:border-cyan-400/50 focus-within:bg-cyan-500/[0.04]">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {formatHotkeyForDisplay(hotkey).map((part) => (
                <span
                  key={part}
                  className="rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-3 text-xl font-semibold tracking-tight text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)]"
                >
                  {part}
                </span>
              ))}
            </div>

            <input
              value={isCapturing ? "" : hotkey}
              readOnly
              onFocus={() => setIsCapturing(true)}
              onBlur={() => setIsCapturing(false)}
              onKeyDown={(event) => void captureHotkey(event)}
              placeholder={isCapturing ? "Recording..." : "Click here and press keys"}
              className="input-control hotkey-capture-input mx-auto max-w-xl text-center text-sm"
            />

            <div className="text-xs uppercase tracking-[0.22em] text-neutral-500">
              {isCapturing ? "Recording..." : "Current shortcut"}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <GuidanceCard
            title="Press and hold behavior"
            description="Recording starts on key press and the desktop pipeline runs when you release the shortcut."
          />
          <GuidanceCard
            title="Conflict handling"
            description="If the shortcut does not register, macOS or another app is already using it. Try a different combination."
          />
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <ToggleCard
          title="Auto-paste after rewrite"
          description="When accessibility permission is granted, DictateAI inserts the rewritten text directly into the focused field."
          checked={autoPaste}
          onToggle={(nextValue) => {
            setAutoPaste(nextValue);
            void toggleSetting("auto_paste", nextValue);
          }}
        />
        <ToggleCard
          title="Sound feedback"
          description="Play start, stop, and error feedback sounds during the dictation flow."
          checked={soundEnabled}
          onToggle={(nextValue) => {
            setSoundEnabled(nextValue);
            void toggleSetting("sound_enabled", nextValue);
          }}
        />
      </section>

      <div className="flex items-start gap-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] px-5 py-4">
        <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-300">
          <ShieldIcon className="h-4 w-4" />
        </div>
        <p className="text-sm leading-7 text-neutral-400">
          Hotkey changes apply immediately through the Tauri global shortcut layer. This is the
          real desktop shortcut, not a browser-tab shortcut.
        </p>
      </div>
    </div>
  );
}

function GuidanceCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/35 p-5">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-2 text-xs leading-6 text-neutral-500">{description}</div>
    </div>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: (nextValue: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-6 text-left shadow-[0_20px_60px_rgba(0,0,0,0.28)] transition hover:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-5">
        <div className="space-y-2">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs leading-6 text-neutral-500">{description}</div>
        </div>
        <span
          className={[
            "mt-1 inline-flex h-6 w-11 rounded-full p-1 transition",
            checked ? "bg-cyan-500" : "bg-white/[0.08]",
          ].join(" ")}
        >
          <span
            className={[
              "h-4 w-4 rounded-full bg-white transition",
              checked ? "translate-x-5" : "translate-x-0",
            ].join(" ")}
          />
        </span>
      </div>
    </button>
  );
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
