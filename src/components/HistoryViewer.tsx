import { useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  getSetting,
  updateHistoryEntry,
} from "../lib/commands";
import type { HistoryEntry } from "../lib/types";
import { getLocaleTag } from "../lib/ui";

const PER_PAGE = 50;

export default function HistoryViewer() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [notice, setNotice] = useState("");
  const [language, setLanguage] = useState("en");

  useEffect(() => {
    void getHistory(0, PER_PAGE)
      .then(([data]) => {
        setEntries(data);
        setFilteredEntries(data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void getSetting("interface_language")
      .catch(() => "en")
      .then((value) => setLanguage(value))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const next = entries.filter((entry) => {
      const term = search.trim().toLowerCase();
      if (!term) {
        return true;
      }

      return (
        entry.raw_text.toLowerCase().includes(term) ||
        entry.rewritten.toLowerCase().includes(term) ||
        entry.model_used.toLowerCase().includes(term)
      );
    });
    setFilteredEntries(next);
  }, [entries, search]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const refreshEntries = async () => {
    const [data] = await getHistory(0, PER_PAGE);
    setEntries(data);
  };

  const handleDelete = async (id: number) => {
    await deleteHistoryEntry(id).then(
      async () => {
        setNotice("History entry deleted.");
        await refreshEntries();
      },
      (error) => setNotice(normalizeError(error, "Unable to delete history entry."))
    );
  };

  const handleClear = async () => {
    await clearHistory().then(
      async () => {
        setNotice("History cleared.");
        await refreshEntries();
      },
      (error) => setNotice(normalizeError(error, "Unable to clear history."))
    );
  };

  const handleSaveEdit = async () => {
    if (editingId === null || !editValue.trim()) {
      return;
    }

    await updateHistoryEntry(editingId, editValue.trim()).then(
      async () => {
        setNotice("Rewrite updated.");
        setEditingId(null);
        setEditValue("");
        await refreshEntries();
      },
      (error) => setNotice(normalizeError(error, "Unable to update history entry."))
    );
  };

  if (loading) {
    return <div className="px-12 py-14 text-sm text-neutral-500">Loading...</div>;
  }

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">History</h1>
          <p className="max-w-2xl text-sm leading-7 text-neutral-400 md:text-base">
            Review the raw transcript, edit the rewritten output, and copy or remove previous runs.
          </p>
        </div>
        {entries.length > 0 ? (
          <button
            type="button"
            onClick={() => void handleClear()}
            className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
          >
            Clear history
          </button>
        ) : null}
      </header>

      {notice ? (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] px-4 py-3 text-sm text-cyan-200">
          {notice}
        </div>
      ) : null}

      <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search history..."
          className="input-control"
        />
      </div>

      {filteredEntries.length === 0 ? (
        <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] px-6 py-12 text-center text-sm text-neutral-500 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          No history entries match your search.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEntries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const isEditing = editingId === entry.id;

            return (
              <article
                key={entry.id}
                className="rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-xs text-neutral-500">
                      {new Date(`${entry.created_at}Z`).toLocaleString(getLocaleTag(language))} |{" "}
                      {(entry.duration_ms / 1000).toFixed(1)}s | {entry.model_used}
                    </div>
                    <div className="mt-2 text-base font-medium text-white">{entry.rewritten}</div>
                  </button>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void writeText(entry.rewritten)
                          .then(() => setNotice("Copied to clipboard."))
                          .catch(() => setNotice("Unable to copy to clipboard."))
                      }
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-neutral-200 transition hover:bg-white/[0.06]"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditValue(entry.rewritten);
                        setExpandedId(entry.id);
                      }}
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-neutral-200 transition hover:bg-white/[0.06]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry.id)}
                      className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 transition hover:bg-red-500/15"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-5 space-y-4 border-t border-white/[0.06] pt-5">
                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                        Raw transcription
                      </div>
                      <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-4 text-sm leading-7 text-neutral-300">
                        {entry.raw_text}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
                        Rewritten
                      </div>
                      {isEditing ? (
                        <div className="space-y-3">
                          <textarea
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            className="input-control min-h-32 resize-y p-4 text-sm leading-7 text-neutral-200"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setEditValue("");
                              }}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-neutral-200 transition hover:bg-white/[0.06]"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveEdit()}
                              className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-400"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4 text-sm leading-7 text-white">
                          {entry.rewritten}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
