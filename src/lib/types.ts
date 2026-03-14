export interface HistoryEntry {
  id: number;
  raw_text: string;
  rewritten: string;
  model_used: string;
  duration_ms: number;
  created_at: string;
  favorited: boolean;
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

export type AppStatus = "idle" | "recording" | "processing";
