export interface HistoryEntry {
  id: number;
  raw_text: string;
  rewritten: string;
  model_used: string;
  duration_ms: number;
  created_at: string;
}

export interface VocabularyTerm {
  id: number;
  term: string;
  phonetic: string | null;
  definition: string | null;
  category: string;
  use_count: number;
  created_at: string;
}

export interface ModelInfo {
  name: string;
  label: string;
  description: string;
  filename: string;
  size_mb: number;
}

export interface OnDeviceStatus {
  ready: boolean;
  modelsDownloaded: boolean;
  whisperDownloaded: boolean;
  llamaDownloaded: boolean;
  llamaRuntimeAvailable: boolean;
}

export type AppStatus = "idle" | "recording" | "processing";
