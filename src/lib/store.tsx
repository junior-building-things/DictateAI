import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { errorMessage } from "./utils";
import {
  deleteHistoryEntry,
  getHistory,
  getSettings,
  saveSetting,
  setHistoryFavorite,
  updateHistoryEntry,
  updateHotkey,
  onICloudSynced,
} from "./commands";
import {
  DEFAULT_REWRITE_PROVIDER,
  DEFAULT_SPEECH_PROVIDER,
  defaultRewriteModel,
  defaultSpeechModel,
  normalizeRewriteProvider,
  normalizeSpeechProvider,
  rewriteModelLabelToSetting,
  rewriteModelSettingToLabel,
  speechModelLabelToSetting,
  speechModelSettingToLabel,
  type RewriteProvider,
  type SpeechProvider,
} from "./modelCatalog";
import { useI18n } from "./i18n";
import type { HistoryEntry } from "./types";
import { displayHotkeyFromTauri, tauriHotkeyFromDisplay } from "./hotkeys";
export type HotkeyMode = "hold" | "toggle";

export interface HistoryItem {
  id: number;
  time: string;
  date: string;
  /**
   * ISO timestamp from the backend. Kept alongside the formatted `date`
   * string so dashboard aggregations can apply real date-range math
   * (e.g. "last 7 days") instead of string-matching the formatted label.
   */
  createdAt: string;
  original: string;
  rewritten: string;
  favorited: boolean;
  /**
   * Optional API usage telemetry. Populated by the backend for cloud
   * speech/rewrite providers; absent for local models. Dashboards should
   * treat missing values as 0 so the totals degrade gracefully until the
   * backend pipeline starts writing these fields.
   */
  tokens?: number;
  cost?: number;
  /** Ms from ending the recording to the text appearing; null for older rows. */
  latencyMs: number | null;
}

export const rewriteToneOptions = [
  "neutral",
  "casual",
  "friendly",
  "professional",
  "enthusiastic",
] as const;

export type RewriteTone = (typeof rewriteToneOptions)[number];

export interface RewriteRulesState {
  tone: RewriteTone;
  useVocabulary: boolean;
  useFavorites: boolean;
  useCustomPrompt: boolean;
  customPrompt: string;
}

export interface ModelsState {
  speechProvider: SpeechProvider;
  speechModel: string;
  rewriteProvider: RewriteProvider;
  rewriteModel: string;
}

export interface HotkeyState {
  hotkey: string;
  mode: HotkeyMode;
  autoPaste: boolean;
  /** When true, editing a dictation in History pops a toast offering to
   * add any new proper-noun-shaped word to the vocabulary. Off → silent. */
  autoAddVocabulary: boolean;
}

export interface UpdateState {
  currentVersion: string;
  availableVersion: string | null;
  status: "checking" | "idle" | "downloading" | "ready" | "error";
  downloadProgress: number | null;
}

interface AppState {
  history: HistoryItem[];
  rewriteRules: RewriteRulesState;
  models: ModelsState;
  hotkeySettings: HotkeyState;
  updates: UpdateState;
  refreshHistory: () => Promise<void>;
  deleteHistoryItem: (id: number) => Promise<void>;
  toggleFavorite: (id: number) => void;
  updateHistoryRewritten: (id: number, rewritten: string) => Promise<void>;
  setRewriteRules: (rules: Partial<RewriteRulesState>) => Promise<void>;
  setModels: (models: Partial<ModelsState>) => Promise<void>;
  setHotkeySettings: (settings: Partial<HotkeyState>) => Promise<void>;
}

const HISTORY_FAVORITES_KEY = "dictateai-history-favorites";

const defaultRewriteRules: RewriteRulesState = {
  tone: "neutral",
  useVocabulary: true,
  useFavorites: false,
  useCustomPrompt: false,
  customPrompt: "",
};

const defaultModels: ModelsState = {
  speechProvider: DEFAULT_SPEECH_PROVIDER,
  speechModel: defaultSpeechModel(DEFAULT_SPEECH_PROVIDER),
  rewriteProvider: DEFAULT_REWRITE_PROVIDER,
  rewriteModel: defaultRewriteModel(DEFAULT_REWRITE_PROVIDER),
};

const defaultHotkeySettings: HotkeyState = {
  hotkey: "Right Option",
  mode: "hold",
  autoPaste: true,
  autoAddVocabulary: true,
};

const defaultUpdateState: UpdateState = {
  // Filled from the app bundle on launch; empty hides the version until then.
  currentVersion: "",
  availableVersion: null,
  status: "checking",
  downloadProgress: null,
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const tRef = useRef(t);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Read by toggleFavorite: values assigned inside a setState updater aren't
  // reliably available synchronously, since React may defer the updater.
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  const [rewriteRules, setRewriteRulesState] = useState<RewriteRulesState>(defaultRewriteRules);
  const [models, setModelsState] = useState<ModelsState>(defaultModels);
  const [hotkeySettings, setHotkeySettingsState] = useState<HotkeyState>(defaultHotkeySettings);
  const [updates, setUpdates] = useState<UpdateState>(defaultUpdateState);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const refreshHistory = useCallback(async () => {
    try {
      const entries = await getAllHistory();
      setHistory(entries.map((entry) => mapHistoryEntry(entry)));
    } catch (error) {
      toast.error(errorMessage(error, "Unable to load history."));
    }
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [settings, historyEntries] = await Promise.all([
          getSettings(),
          getAllHistory(),
        ]);
        if (!active) {
          return;
        }

        const settingsMap = new Map(settings);
        setRewriteRulesState(deriveRewriteRules(settingsMap));
        const nextModels = deriveModels(settingsMap);
        setModelsState(nextModels);
        if (modelsNeedMigration(settingsMap, nextModels)) {
          void persistModels(nextModels);
        }
        setHotkeySettingsState(deriveHotkeyState(settingsMap));
        const nextHistory = historyEntries.map((entry) => mapHistoryEntry(entry));
        setHistory(nextHistory);
        void migrateLegacyFavorites(historyEntries, setHistory);
      } catch (error) {
        if (active) {
          toast.error(errorMessage(error, "Unable to load app settings."));
        }
      }
    };

    void load();
    const stopSyncListener = onICloudSynced(() => void load());
    return () => {
      active = false;
      stopSyncListener();
    };
  }, []);

  useEffect(() => {
    let active = true;
    // Set once an update is downloaded; it applies on the next launch, so
    // there's nothing more to check for until then.
    let installed = false;

    const runUpdateCheck = async (showErrors: boolean) => {
      if (installed) {
        return;
      }
      try {
        const version = await getVersion().catch(() => tRef.current("version").replace(/^v/, ""));
        if (!active) {
          return;
        }

        setUpdates((previous) => ({
          ...previous,
          currentVersion: version,
          status: "checking",
          downloadProgress: null,
        }));

        const update = await check();
        if (!active) {
          await update?.close().catch(() => undefined);
          return;
        }

        if (!update) {
          setUpdates({
            currentVersion: version,
            availableVersion: null,
            status: "idle",
            downloadProgress: null,
          });
          return;
        }

        setUpdates({
          currentVersion: version,
          availableVersion: update.version,
          status: "downloading",
          downloadProgress: 0,
        });

        let totalBytes = 0;
        let downloadedBytes = 0;

        await update.downloadAndInstall((event) => {
          if (!active) {
            return;
          }

          if (event.event === "Started") {
            totalBytes = event.data.contentLength ?? 0;
            downloadedBytes = 0;
            setUpdates({
              currentVersion: version,
              availableVersion: update.version,
              status: "downloading",
              downloadProgress: totalBytes > 0 ? 0 : null,
            });
            return;
          }

          if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
            setUpdates({
              currentVersion: version,
              availableVersion: update.version,
              status: "downloading",
              downloadProgress: totalBytes > 0
                ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                : null,
            });
            return;
          }

          if (event.event === "Finished") {
            setUpdates({
              currentVersion: version,
              availableVersion: update.version,
              status: "ready",
              downloadProgress: 100,
            });
          }
        });

        if (!active) {
          await update.close().catch(() => undefined);
          return;
        }

        setUpdates({
          currentVersion: version,
          availableVersion: update.version,
          status: "ready",
          downloadProgress: 100,
        });
        installed = true;
        await update.close().catch(() => undefined);
      } catch (error) {
        if (!active) {
          return;
        }

        setUpdates((previous) => ({
          ...previous,
          status: "error",
          downloadProgress: null,
        }));
        // Background checks fail quietly (e.g. offline) rather than toasting
        // every six hours.
        if (showErrors) {
          toast.error(errorMessage(error, tRef.current("unableToCheckForUpdates")));
        }
      }
    };

    void runUpdateCheck(true);
    // DictateAI lives in the menu bar and is rarely quit, so a launch-only
    // check would leave long-running copies on an old version.
    const interval = window.setInterval(() => void runUpdateCheck(false), UPDATE_CHECK_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const deleteHistoryItem = useCallback(async (id: number) => {
    try {
      await deleteHistoryEntry(id);
      setHistory((previous) => previous.filter((item) => item.id !== id));
    } catch (error) {
      toast.error(errorMessage(error, "Unable to delete history entry."));
    }
  }, []);

  const toggleFavorite = useCallback(async (id: number) => {
    const target = historyRef.current.find((item) => item.id === id);
    if (!target) {
      return;
    }
    const previousFavorited = target.favorited;
    const nextFavorited = !previousFavorited;

    setHistory((previous) =>
      previous.map((item) => (item.id === id ? { ...item, favorited: nextFavorited } : item)),
    );

    try {
      await setHistoryFavorite(id, nextFavorited);
    } catch (error) {
      setHistory((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, favorited: previousFavorited } : item,
        ),
      );
      toast.error(errorMessage(error, "Unable to update favorite."));
    }
  }, []);

  const updateHistoryRewritten = useCallback(async (id: number, rewritten: string) => {
    try {
      await updateHistoryEntry(id, rewritten);
      setHistory((previous) =>
        previous.map((item) => (item.id === id ? { ...item, rewritten } : item)),
      );
    } catch (error) {
      toast.error(errorMessage(error, "Unable to update history entry."));
    }
  }, []);

  const setRewriteRules = useCallback(async (updates: Partial<RewriteRulesState>) => {
    setRewriteRulesState((previous) => {
      const next = { ...previous, ...updates };
      void persistRewriteRules(next);
      return next;
    });
  }, []);

  const setModels = useCallback(async (updates: Partial<ModelsState>) => {
    setModelsState((previous) => {
      const next = { ...previous, ...updates };
      void persistModels(next);
      return next;
    });
  }, []);

  const setHotkeySettings = useCallback(async (updates: Partial<HotkeyState>) => {
    setHotkeySettingsState((previous) => {
      const next = { ...previous, ...updates };
      void persistHotkeySettings(previous, next, setHotkeySettingsState);
      return next;
    });
  }, []);

  return (
    <AppContext.Provider
      value={{
        history,
        rewriteRules,
        models,
        hotkeySettings,
        updates,
        refreshHistory,
        deleteHistoryItem,
        toggleFavorite,
        updateHistoryRewritten,
        setRewriteRules,
        setModels,
        setHotkeySettings,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppStore() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppStore must be used within AppProvider");
  }

  return context;
}

function deriveRewriteRules(settings: Map<string, string>): RewriteRulesState {
  return {
    tone: normalizeRewriteTone(settings.get("rewrite_tone")),
    useVocabulary: readBooleanSetting(
      settings,
      "rewrite_use_vocabulary",
      defaultRewriteRules.useVocabulary,
    ),
    useFavorites: readBooleanSetting(
      settings,
      "rewrite_use_favorites",
      defaultRewriteRules.useFavorites,
    ),
    useCustomPrompt: readBooleanSetting(
      settings,
      "rewrite_use_custom_prompt",
      defaultRewriteRules.useCustomPrompt,
    ),
    customPrompt: settings.get("rewrite_system_prompt") ?? defaultRewriteRules.customPrompt,
  };
}

function deriveModels(settings: Map<string, string>): ModelsState {
  const speechProvider = normalizeSpeechProvider(
    settings.get("speech_provider"),
    settings.get("speech_model"),
  );
  const rewriteProvider = normalizeRewriteProvider(
    settings.get("rewrite_provider"),
    settings.get("rewrite_model"),
  );
  const speechModel = speechModelSettingToLabel(speechProvider, settings.get("speech_model"));
  const rewriteModel = rewriteModelSettingToLabel(rewriteProvider, settings.get("rewrite_model"));

  return { speechProvider, speechModel, rewriteProvider, rewriteModel };
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Every stored history row. The Dashboard's 7-day totals and History's search
 * and favorites filter all work on this list, so a capped page under-counted
 * heavy users and hid older starred items. Retention (30 days, plus starred)
 * keeps it bounded.
 */
async function getAllHistory(): Promise<HistoryEntry[]> {
  const [entries, total] = await getHistory(0, 500);
  if (total <= entries.length) {
    return entries;
  }
  const [allEntries] = await getHistory(0, total);
  return allEntries;
}

function deriveHotkeyState(settings: Map<string, string>): HotkeyState {
  return {
    hotkey: displayHotkeyFromTauri(settings.get("hotkey") || "Right Option"),
    mode: settings.get("hotkey_mode") === "toggle" ? "toggle" : "hold",
    autoPaste: readBooleanSetting(
      settings,
      "auto_paste",
      readBooleanSetting(settings, "auto_copy", defaultHotkeySettings.autoPaste),
    ),
    autoAddVocabulary: readBooleanSetting(
      settings,
      "auto_add_vocabulary",
      defaultHotkeySettings.autoAddVocabulary,
    ),
  };
}

async function persistRewriteRules(next: RewriteRulesState) {
  try {
    await Promise.all([
      saveSetting("rewrite_tone", next.tone),
      saveSetting("rewrite_use_vocabulary", String(next.useVocabulary)),
      saveSetting("rewrite_use_favorites", String(next.useFavorites)),
      saveSetting("rewrite_use_custom_prompt", String(next.useCustomPrompt)),
      saveSetting("rewrite_system_prompt", next.customPrompt),
    ]);
  } catch (error) {
    toast.error(errorMessage(error, "Unable to save rewrite rules."));
  }
}

async function persistModels(next: ModelsState) {
  try {
    const writes = [
      saveSetting("speech_provider", next.speechProvider),
      saveSetting("rewrite_provider", next.rewriteProvider),
      saveSetting("speech_model", speechModelLabelToSetting(next.speechProvider, next.speechModel)),
      saveSetting("rewrite_model", rewriteModelLabelToSetting(next.rewriteProvider, next.rewriteModel)),
    ];

    await Promise.all(writes);
  } catch (error) {
    toast.error(errorMessage(error, "Unable to save model settings."));
  }
}

async function persistHotkeySettings(
  previous: HotkeyState,
  next: HotkeyState,
  setState: React.Dispatch<React.SetStateAction<HotkeyState>>,
) {
  try {
    if (previous.hotkey !== next.hotkey) {
      await updateHotkey(tauriHotkeyFromDisplay(next.hotkey));
    }

    await Promise.all([
      saveSetting("hotkey_mode", next.mode),
      saveSetting("auto_paste", String(next.autoPaste)),
      saveSetting("auto_copy", "false"),
      saveSetting("auto_add_vocabulary", String(next.autoAddVocabulary)),
    ]);
  } catch (error) {
    setState(previous);
    toast.error(errorMessage(error, "Unable to save hotkey settings."));
  }
}

function readBooleanSetting(
  settings: Map<string, string>,
  key: string,
  fallback: boolean,
) {
  const value = settings.get(key);
  if (value === undefined) {
    return fallback;
  }

  return value === "true";
}

function normalizeRewriteTone(value: string | undefined): RewriteTone {
  if (value === "confident") {
    return "professional";
  }

  if (value && rewriteToneOptions.includes(value as RewriteTone)) {
    return value as RewriteTone;
  }

  return defaultRewriteRules.tone;
}

function loadLegacyFavorites(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(HISTORY_FAVORITES_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function clearLegacyFavorites() {
  try {
    localStorage.removeItem(HISTORY_FAVORITES_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function mapHistoryEntry(entry: HistoryEntry): HistoryItem {
  const createdAt = parseHistoryDate(entry.created_at);

  return {
    id: entry.id,
    time: createdAt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
    date: createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    createdAt: createdAt.toISOString(),
    original: entry.raw_text,
    rewritten: entry.rewritten,
    favorited: entry.favorited,
    tokens: entry.tokens,
    cost: entry.cost,
    latencyMs: entry.latency_ms,
  };
}

async function migrateLegacyFavorites(
  entries: HistoryEntry[],
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>,
) {
  const legacyFavorites = loadLegacyFavorites();
  const favoriteIds = entries
    .filter((entry) => legacyFavorites[String(entry.id)] && !entry.favorited)
    .map((entry) => entry.id);

  if (favoriteIds.length === 0) {
    if (Object.keys(legacyFavorites).length > 0) {
      clearLegacyFavorites();
    }
    return;
  }

  try {
    await Promise.all(favoriteIds.map((id) => setHistoryFavorite(id, true)));
    setHistory((previous) =>
      previous.map((item) => (favoriteIds.includes(item.id) ? { ...item, favorited: true } : item)),
    );
    clearLegacyFavorites();
  } catch {
    // Keep legacy favorites in place so they can be retried later.
  }
}

function parseHistoryDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function modelsNeedMigration(settings: Map<string, string>, next: ModelsState) {
  return settings.get("speech_provider") !== next.speechProvider
    || settings.get("rewrite_provider") !== next.rewriteProvider
    || settings.get("speech_model")
      !== speechModelLabelToSetting(next.speechProvider, next.speechModel)
    || settings.get("rewrite_model")
      !== rewriteModelLabelToSetting(next.rewriteProvider, next.rewriteModel);
}
