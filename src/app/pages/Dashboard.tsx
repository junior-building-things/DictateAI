import { useEffect, useMemo, useState } from "react";
import { Hand, Languages as LanguagesIcon, Mic2, MousePointerClick, Sparkles } from "lucide-react";
import { getSettings } from "../../lib/commands";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { rewriteModelSettingToLabel, speechModelSettingToLabel } from "../../lib/modelCatalog";

/** Words spoken per second baseline used to convert dictated words into a
 * "time saved vs. typing" estimate. 0.5s/word ≈ typing at ~120 wpm. */
const SECONDS_SAVED_PER_WORD = 0.5;

export const Dashboard = () => {
  useI18n();
  const { hotkeySettings, setHotkeySettings, history, models } = useAppStore();
  const [language, setLanguage] = useState("en");

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
    <div className="page-body">
      {/* Hero */}
      <section className="hero">
        <div className="hero-top">
          <h1 className="hero-headline">
            Press
            {hotkeyTokens.map((token, i) => (
              <span key={i} className="kbd-inline">
                {token}
              </span>
            ))}
            to dictate.
          </h1>
          <div className="hero-mode" role="group" aria-label="Trigger mode">
            <button
              type="button"
              className={hotkeySettings.mode === "hold" ? "active" : ""}
              onClick={() => void setHotkeySettings({ mode: "hold" })}
            >
              <Hand strokeWidth={2} />
              Hold
            </button>
            <button
              type="button"
              className={hotkeySettings.mode === "toggle" ? "active" : ""}
              onClick={() => void setHotkeySettings({ mode: "toggle" })}
            >
              <MousePointerClick strokeWidth={2} />
              Tap
            </button>
          </div>
        </div>

        <div className="hero-body">
          <p className="hero-tagline">
            Speech is captured locally, then cleaned up by your chosen rewrite model.
          </p>
        </div>

        <div className="hero-foot">
          <span className="meta">
            <Mic2 size={11} strokeWidth={2} />
            Speech<span className="v">{speechLabel}</span>
          </span>
          <span className="meta-sep" />
          <span className="meta">
            <Sparkles size={11} strokeWidth={2} />
            Rewrite<span className="v">{rewriteLabel}</span>
          </span>
          <span className="meta-sep" />
          <span className="meta">
            <LanguagesIcon size={11} strokeWidth={2} />
            Language<span className="v">{language}</span>
          </span>
        </div>
      </section>

      {/* Stat strip — trailing 7-day rollups. Tokens & cost are populated by
       * the backend for API-based providers; local-only sessions show 0. */}
      <div className="stat-strip">
        <div className="stat">
          <span className="stat-label">Words</span>
          <span className="stat-val">{words7d.toLocaleString()}</span>
          <span className="stat-sub">last 7 days</span>
        </div>
        <div className="stat">
          <span className="stat-label">Time saved</span>
          <span className="stat-val">{timeSaved}</span>
          <span className="stat-sub">vs. typing</span>
        </div>
        <div className="stat">
          <span className="stat-label">Tokens</span>
          <span className="stat-val mono">{tokens7d.toLocaleString()}</span>
          <span className="stat-sub">API usage</span>
        </div>
        <div className="stat">
          <span className="stat-label">Cost</span>
          <span className="stat-val">{formatCost(cost7d)}</span>
          <span className="stat-sub">last 7 days</span>
        </div>
      </div>

      {/* Recent dictations */}
      <div style={{ marginTop: "22px" }}>
        <div className="dash-head">
          <span className="label">Recent</span>
          <span className="count">{recent.length}</span>
          <span className="bar" />
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            <p>No dictations yet — press your hotkey to start.</p>
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
  );
};

function parseHotkey(hotkey: string): string[] {
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
  return `$${amount.toFixed(2)}`;
}
