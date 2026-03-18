import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import {
  deleteHistoryEntry,
  getHistory,
  getSettings,
  saveSetting,
  setHistoryFavorite,
  updateHistoryEntry,
  updateHotkey,
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
  original: string;
  rewritten: string;
  favorited: boolean;
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
  hotkey: "⌥ + Space",
  mode: "hold",
  autoPaste: true,
};

const defaultUpdateState: UpdateState = {
  currentVersion: "1.0.5",
  availableVersion: null,
  status: "checking",
  downloadProgress: null,
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const tRef = useRef(t);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rewriteRules, setRewriteRulesState] = useState<RewriteRulesState>(defaultRewriteRules);
  const [models, setModelsState] = useState<ModelsState>(defaultModels);
  const [hotkeySettings, setHotkeySettingsState] = useState<HotkeyState>(defaultHotkeySettings);
  const [updates, setUpdates] = useState<UpdateState>(defaultUpdateState);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const refreshHistory = useCallback(async () => {
    try {
      const [entries] = await getHistory(0, 200);
      setHistory(entries.map((entry) => mapHistoryEntry(entry)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load history.");
    }
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [settings, historyPage] = await Promise.all([
          getSettings(),
          getHistory(0, 200),
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
        const nextHistory = historyPage[0].map((entry) => mapHistoryEntry(entry));
        setHistory(nextHistory);
        void migrateLegacyFavorites(historyPage[0], setHistory);
      } catch (error) {
        if (active) {
          toast.error(error instanceof Error ? error.message : "Unable to load app settings.");
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const runUpdateCheck = async () => {
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
        toast.info(tRef.current("updateDownloadingToast", { version: update.version }));

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
        toast.info(tRef.current("updateReadyOnNextLaunchToast", { version: update.version }));
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
        toast.error(error instanceof Error ? error.message : tRef.current("unableToCheckForUpdates"));
      }
    };

    void runUpdateCheck();

    return () => {
      active = false;
    };
  }, []);

  const deleteHistoryItem = useCallback(async (id: number) => {
    try {
      await deleteHistoryEntry(id);
      setHistory((previous) => previous.filter((item) => item.id !== id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete history entry.");
    }
  }, []);

  const toggleFavorite = useCallback(async (id: number) => {
    let previousFavorited: boolean | null = null;
    let nextFavorited: boolean | null = null;

    setHistory((previous) =>
      previous.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const updatedFavorited = !item.favorited;
        previousFavorited = item.favorited;
        nextFavorited = updatedFavorited;
        return { ...item, favorited: updatedFavorited };
      }),
    );

    if (previousFavorited === null || nextFavorited === null) {
      return;
    }

    try {
      await setHistoryFavorite(id, nextFavorited);
    } catch (error) {
      setHistory((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, favorited: previousFavorited as boolean } : item,
        ),
      );
      toast.error(error instanceof Error ? error.message : "Unable to update favorite.");
    }
  }, []);

  const updateHistoryRewritten = useCallback(async (id: number, rewritten: string) => {
    try {
      await updateHistoryEntry(id, rewritten);
      setHistory((previous) =>
        previous.map((item) => (item.id === id ? { ...item, rewritten } : item)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update history entry.");
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

function deriveHotkeyState(settings: Map<string, string>): HotkeyState {
  return {
    hotkey: displayHotkeyFromTauri(settings.get("hotkey") || "Alt+Space"),
    mode: settings.get("hotkey_mode") === "toggle" ? "toggle" : "hold",
    autoPaste: readBooleanSetting(
      settings,
      "auto_paste",
      readBooleanSetting(settings, "auto_copy", defaultHotkeySettings.autoPaste),
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
    toast.error(error instanceof Error ? error.message : "Unable to save rewrite rules.");
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
    toast.error(error instanceof Error ? error.message : "Unable to save model settings.");
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
    ]);
  } catch (error) {
    setState(previous);
    toast.error(error instanceof Error ? error.message : "Unable to save hotkey settings.");
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
    original: entry.raw_text,
    rewritten: entry.rewritten,
    favorited: entry.favorited,
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
