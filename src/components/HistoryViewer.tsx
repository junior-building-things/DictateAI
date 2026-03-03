import { useEffect, useState } from "react";
import { getHistory, deleteHistoryEntry, clearHistory } from "../lib/commands";
import type { HistoryEntry } from "../lib/types";
import { useI18n } from "../lib/i18n";

const PER_PAGE = 20;

export default function HistoryViewer() {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    void loadPage(0);
  }, []);

  const loadPage = async (p: number) => {
    setLoading(true);
    const [data, count] = await getHistory(p, PER_PAGE);
    setEntries(data);
    setTotal(count);
    setPage(p);
    setLoading(false);
  };

  const handleDelete = async (id: number) => {
    await deleteHistoryEntry(id);
    void loadPage(page);
  };

  const handleClear = async () => {
    await clearHistory();
    void loadPage(0);
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <section className="space-y-5 p-7">
      <div className="flex items-center justify-between gap-3">
        {total > 0 && (
          <button
            onClick={handleClear}
            className="rounded-xl border border-red-700/40 bg-red-900/20 px-3.5 py-2 text-xs font-semibold text-red-300 transition hover:border-red-600/60 hover:bg-red-900/30"
          >
            {t("clearAll")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">{t("loading")}</div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          {t("noHistory")}
        </p>
      ) : (
        <>
          <div className="max-h-[450px] space-y-2 overflow-y-auto">
            {entries.map((entry) => (
              <article
                key={entry.id}
                className="cursor-pointer rounded-2xl border border-neutral-800 bg-neutral-900/65 p-4 transition hover:border-neutral-700"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs text-neutral-500">
                      {new Date(entry.created_at + "Z").toLocaleString(getLocaleTag(language))} | {(entry.duration_ms / 1000).toFixed(1)}s
                    </div>
                    <div className="truncate text-sm text-neutral-200">{entry.rewritten}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(entry.id);
                    }}
                    className="rounded-lg border border-transparent px-2 py-1 text-xs text-neutral-500 transition hover:border-neutral-600 hover:bg-neutral-900/80 hover:text-red-300"
                  >
                    {t("delete")}
                  </button>
                </div>

                {expandedId === entry.id && (
                  <div className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
                    <div>
                      <div className="mb-1 text-xs text-neutral-500">{t("rawTranscription")}</div>
                      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
                        {entry.raw_text}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-neutral-500">{t("rewritten")}</div>
                      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-200">
                        {entry.rewritten}
                      </div>
                    </div>
                    <div className="text-xs text-neutral-500">{t("model")}: {entry.model_used}</div>
                  </div>
                )}
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => void loadPage(page - 1)}
                disabled={page === 0}
                className="rounded-xl border border-neutral-700 bg-neutral-900/80 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-950/80 disabled:opacity-40"
              >
                {t("prev")}
              </button>
              <span className="px-3 py-1 text-sm text-neutral-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => void loadPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="rounded-xl border border-neutral-700 bg-neutral-900/80 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:bg-neutral-950/80 disabled:opacity-40"
              >
                {t("next")}
              </button>
            </div>
          )}
        </>
      )}

    </section>
  );
}

function getLocaleTag(language: string) {
  const map: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    ja: "ja-JP",
    zh: "zh-CN",
    sv: "sv-SE",
    fi: "fi-FI",
  };

  return map[language] ?? "en-US";
}
