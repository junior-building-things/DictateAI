import { useCallback, useEffect, useMemo, useState } from "react";
import { Hand, Languages as LanguagesIcon, Mic2, MousePointerClick, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import {
  checkAccessibility,
  getProcessingModeStatus,
  getSettings,
} from "../../lib/commands";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { rewriteModelSettingToLabel, speechModelSettingToLabel } from "../../lib/modelCatalog";
import { getMicrophonePermissionState, type MicrophonePermissionState } from "../../lib/ui";

/** Window event the Settings → Models tab fires after saving any API key
 * or downloading a local model. Keep in sync with `Models.tsx`. */
const SETTINGS_CHANGED_EVENT = "dictateai-settings-changed";

/** localStorage key Settings uses to remember which sub-tab to show. We
 * pre-write "models" before navigating from the Dashboard's "Configure"
 * link so the user lands directly on the right pane. */
const SETTINGS_TAB_STORAGE_KEY = "dictateai.settingsTab";

/** Words spoken per second baseline used to convert dictated words into a
 * "time saved vs. typing" estimate. 0.5s/word ≈ typing at ~120 wpm. */
const SECONDS_SAVED_PER_WORD = 0.5;

export const Dashboard = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { hotkeySettings, setHotkeySettings, history, models } = useAppStore();
  const [language, setLanguage] = useState("en");
  // Optimistic default: assume both halves are ready until the backend
  // tells us otherwise. Avoids a flash of "Configure speech model" on a
  // fully-set-up machine while the IPC round-trip is in flight.
  const [speechReady, setSpeechReady] = useState(true);
  const [rewriteReady, setRewriteReady] = useState(true);
  // Permission state — `null`/`"unknown"` until the first sync round-trip.
  // Treated as "granted" while pending so we don't briefly hide the
  // ready-state headline on a freshly-launched, fully-permissioned app.
  const [micPerm, setMicPerm] = useState<MicrophonePermissionState>("unknown");
  const [axEnabled, setAxEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = async () => {
      const settings = await getSettings().catch(() => null as [string, string][] | null);
      if (settings) {
        const map = new Map(settings);
        setLanguage(map.get("language") || "en");
      }
    };
    void sync();
  }, []);

  // Re-check processing-mode readiness on mount, when the selected speech /
  // rewrite model changes (`models` from the store), and whenever Settings
  // emits the `dictateai-settings-changed` event (any API-key save or
  // local-model install/remove). The backend command is cheap (just DB
  // reads + file existence checks) so we don't worry about debouncing.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await getProcessingModeStatus();
        if (cancelled) return;
        setSpeechReady(status.speechReady);
        setRewriteReady(status.rewriteReady);
      } catch {
        // Swallow IPC errors — defaulting to ready avoids hiding the
        // hotkey instructions on a transient failure.
      }
    };
    void refresh();
    const onSettingsChanged = () => void refresh();
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
    };
  }, [models.speechProvider, models.speechModel, models.rewriteProvider, models.rewriteModel]);

  // Permission sync — mirrors the pattern in Settings → General. macOS
  // permission state can flip mid-session (user grants/revokes in System
  // Settings) so we re-check on every window focus and visibility change.
  const syncPermissions = useCallback(async () => {
    const [m, a] = await Promise.all([
      getMicrophonePermissionState(),
      checkAccessibility().catch(() => null),
    ]);
    setMicPerm(m);
    setAxEnabled(a);
  }, []);

  useEffect(() => {
    void syncPermissions();
    const onFocus = () => void syncPermissions();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [syncPermissions]);

  // `unknown` / `null` treated as granted to avoid the brief flash of
  // "Grant permissions" on first paint while the IPC is still in flight.
  // Once the backend reports a definite state, we honor it.
  const micMissing = micPerm !== "granted" && micPerm !== "unknown";
  const axMissing = axEnabled === false;
  const permissionsMissing = micMissing || axMissing;

  const openSettings = (tab: "general" | "models") => {
    // Pre-select the appropriate sub-tab so the user lands where they need
    // to go in one click. Settings.tsx reads this key in its `useState`
    // initializer on mount.
    try {
      window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
    } catch {
      // Storage might be disabled (private mode etc.) — non-fatal.
    }
    navigate("/settings");
  };

  const hotkeyTokens = useMemo(() => parseHotkey(hotkeySettings.hotkey), [hotkeySettings.hotkey]);
  const recent = history.slice(0, 5);

  // Aggregations over the trailing 7-day window. `createdAt` is the ISO
  // timestamp persisted alongside the formatted `date` label so we can do
  // precise range math instead of string-matching the localized date.
  const last7d = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return history.filter((entry) => {
      const ts = Date.parse(entry.createdAt);
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }, [history]);

  const words7d = useMemo(
    () => last7d.reduce((acc, entry) => acc + wordCount(entry.rewritten || entry.original), 0),
    [last7d],
  );
  const tokens7d = useMemo(
    () => last7d.reduce((acc, entry) => acc + (entry.tokens ?? 0), 0),
    [last7d],
  );
  const cost7d = useMemo(
    () => last7d.reduce((acc, entry) => acc + (entry.cost ?? 0), 0),
    [last7d],
  );
  const timeSaved = useMemo(() => formatDuration(words7d * SECONDS_SAVED_PER_WORD), [words7d]);

  const speechLabel = speechModelSettingToLabel(models.speechProvider, models.speechModel);
  const rewriteLabel = rewriteModelSettingToLabel(models.rewriteProvider, models.rewriteModel);

  return (
    <div className="page-scroll">
      <div className="page-body">
      {/* Hero */}
      <section className="hero">
        <div className="hero-top">
          {/* Four-state headline, priority top-down:
           *   1. Permissions missing → "Grant permissions to start dictating."
           *      (mic + accessibility — even if everything else is ready,
           *      the hotkey won't fire without these, so we surface it
           *      first.) Link → Settings → General (permissions section).
           *   2. Speech model unconfigured → "Configure speech model …"
           *   3. Rewrite model unconfigured → "Configure rewrite model …"
           *      (Speech wins if both are missing — you can't rewrite
           *      what you couldn't transcribe.)
           *   4. Everything ready → "Tap/Hold ⌘A to dictate." */}
          {permissionsMissing ? (
            <h1 className="hero-headline">
              <button
                type="button"
                className="hero-link"
                onClick={() => openSettings("general")}
              >
                {t("grantButton")}
              </button>{" "}
              {t("permissionsToStartDictating")}
            </h1>
          ) : !speechReady || !rewriteReady ? (
            <h1 className="hero-headline">
              <button
                type="button"
                className="hero-link"
                onClick={() => openSettings("models")}
              >
                {t("configureButton")}
              </button>{" "}
              {speechReady ? t("rewriteModelToStartDictating") : t("speechModelToStartDictating")}
            </h1>
          ) : (
            <h1 className="hero-headline">
              {hotkeySettings.mode === "toggle" ? t("tapToDictatePrefix") : t("holdToDictatePrefix")}
              {hotkeyTokens.map((token, i) => (
                <span key={i} className="kbd-inline">
                  {token}
                </span>
              ))}
              {t("toDictateSuffix")}
            </h1>
          )}
          <div className="hero-mode" role="group" aria-label={t("triggerModeLabel") || "Trigger mode"}>
            <button
              type="button"
              className={hotkeySettings.mode === "hold" ? "active" : ""}
              onClick={() => void setHotkeySettings({ mode: "hold" })}
            >
              <Hand strokeWidth={2} />
              {t("holdLabel")}
            </button>
            <button
              type="button"
              className={hotkeySettings.mode === "toggle" ? "active" : ""}
              onClick={() => void setHotkeySettings({ mode: "toggle" })}
            >
              <MousePointerClick strokeWidth={2} />
              {t("tapLabel")}
            </button>
          </div>
        </div>

        <div className="hero-body">
          <p className="hero-tagline">
            {t("dashboardTagline")}
          </p>
        </div>

        <div className="hero-foot">
          <span className="meta">
            <Mic2 size={11} strokeWidth={2} />
            {t("speechLabel")}<span className="v">{speechLabel}</span>
          </span>
          <span className="meta-sep" />
          <span className="meta">
            <Sparkles size={11} strokeWidth={2} />
            {t("rewriteLabel")}<span className="v">{rewriteLabel}</span>
          </span>
          <span className="meta-sep" />
          <span className="meta">
            <LanguagesIcon size={11} strokeWidth={2} />
            {t("languageLabel")}<span className="v">{language}</span>
          </span>
        </div>
      </section>

      {/* Stat strip — trailing 7-day rollups. Tokens & cost are populated by
       * the backend for API-based providers; local-only sessions show 0. */}
      <div className="stat-strip">
        <div className="stat">
          <span className="stat-label">{t("wordsLast7dLabel")}</span>
          <span className="stat-val">{words7d.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("timeSavedLabel")}</span>
          <span className="stat-val">{timeSaved}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("tokensLabel")}</span>
          <span className="stat-val mono">{tokens7d.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("costLabel")}</span>
          <span className="stat-val">{formatCost(cost7d)}</span>
        </div>
      </div>

      {/* Recent dictations */}
      <div style={{ marginTop: "22px" }}>
        <div className="dash-head">
          <span className="label">{t("recentTitle")}</span>
          <span className="bar" />
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            <p>{t("noRecentDictations")}</p>
          </div>
        ) : (
          recent.map((entry) => (
            <div key={entry.id} className="recent-row">
              <span className="recent-time">{entry.time}</span>
              <span className="recent-text">{entry.rewritten || entry.original}</span>
            </div>
          ))
        )}
      </div>
      </div>
    </div>
  );
};

function parseHotkey(hotkey: string): string[] {
  // "Right Option" is the macOS modifier-only sentinel — display as one
  // kbd-styled token rather than splitting on the space.
  if (hotkey.trim().toLowerCase() === "right option") {
    return ["⌥R"];
  }
  return hotkey
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Format a duration in seconds as a compact "X min" / "X.Y h" label. Picks
 * the larger unit once the value crosses an hour to keep the stat tile short. */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} s`;
  const minutes = totalSeconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)} h`;
}

function formatCost(amount: number): string {
  // Sub-10¢ totals are noisy when shown to two decimals ($0.00, $0.03, $0.07
  // all read as "basically free"). Collapse the bottom range into "<$0.1"
  // so the tile reads as a useful threshold rather than a precise number.
  // Exact zero stays "$0.00" since "no API cost at all" is a meaningful
  // distinct state — typical for fully-local pipelines.
  if (amount === 0) return "$0.00";
  if (amount < 0.1) return "<$0.1";
  return `$${amount.toFixed(2)}`;
}
