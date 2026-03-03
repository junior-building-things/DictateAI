import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry, ModelInfo, OnDeviceStatus, VocabularyTerm } from "./types";

// Settings
export const getSettings = () =>
  invoke<[string, string][]>("get_settings");

export const getSetting = (key: string) =>
  invoke<string>("get_setting", { key });

export const saveSetting = (key: string, value: string) =>
  invoke<void>("save_setting", { key, value });

export const updateHotkey = (hotkey: string) =>
  invoke<void>("update_hotkey", { hotkey });

export const getDefaultSystemPrompt = () =>
  invoke<string>("get_default_system_prompt");

export const checkAccessibility = () =>
  invoke<boolean>("check_accessibility");

export const promptMicrophonePermission = () =>
  invoke<void>("prompt_microphone_permission");

export const promptAccessibilityPermission = () =>
  invoke<void>("prompt_accessibility_permission");

// History
export const getHistory = (page: number, perPage: number) =>
  invoke<[HistoryEntry[], number]>("get_history", { page, perPage });

export const deleteHistoryEntry = (id: number) =>
  invoke<void>("delete_history_entry", { id });

export const clearHistory = () =>
  invoke<void>("clear_history");

// Vocabulary
export const getVocabulary = () =>
  invoke<VocabularyTerm[]>("get_vocabulary");

export const addVocabularyTerm = (
  term: string,
  phonetic: string | null,
  definition: string | null,
  category: string
) =>
  invoke<number>("add_vocabulary_term", { term, phonetic, definition, category });

export const updateVocabularyTerm = (
  id: number,
  term: string,
  phonetic: string | null,
  definition: string | null,
  category: string
) =>
  invoke<void>("update_vocabulary_term", { id, term, phonetic, definition, category });

export const deleteVocabularyTerm = (id: number) =>
  invoke<void>("delete_vocabulary_term", { id });

// Models
export const getAvailableModels = () =>
  invoke<ModelInfo[]>("get_available_models");

export const validateGeminiApiKey = (apiKey: string, modelName: string) =>
  invoke<boolean>("validate_gemini_api_key", { apiKey, modelName });

export const validateOpenAiApiKey = (apiKey: string) =>
  invoke<boolean>("validate_openai_api_key", { apiKey });

// App State
export const getAppState = () =>
  invoke<string>("get_app_state");

export const cancelProcessing = () =>
  invoke<void>("cancel_processing");

export const getOnDeviceStatus = () =>
  invoke<OnDeviceStatus>("get_on_device_status");

export const downloadOnDeviceModels = () =>
  invoke<OnDeviceStatus>("download_on_device_models");

export const removeOnDeviceModels = () =>
  invoke<OnDeviceStatus>("remove_on_device_models");
