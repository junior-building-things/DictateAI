export interface HistoryEntry {
  id: number;
  raw_text: string;
  rewritten: string;
  model_used: string;
  duration_ms: number;
  created_at: string;
  favorited: boolean;
  /** Combined rewrite-model prompt + completion tokens. 0 for local / Apple FM. */
  tokens: number;
  /** Total dictation cost in USD (speech per-minute + rewrite per-token). */
  cost: number;
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
