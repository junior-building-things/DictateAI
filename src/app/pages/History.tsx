import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Search, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { learnNewVocabTerms } from "../../lib/vocabLearn";

export const History = () => {
  const { t } = useI18n();
  const {
    history,
    toggleFavorite,
    deleteHistoryItem,
    updateHistoryRewritten,
    hotkeySettings,
  } = useAppStore();
  const [search, setSearch] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const filteredItems = useMemo(() => {
    return history.filter((item) => {
      const query = search.trim().toLowerCase();
      const matchesSearch =
        query.length === 0 ||
        item.original.toLowerCase().includes(query) ||
        item.rewritten.toLowerCase().includes(query);
      const matchesFilter = showFavoritesOnly ? item.favorited : true;
      return matchesSearch && matchesFilter;
    });
  }, [history, search, showFavoritesOnly]);

  useEffect(() => {
    if (search) searchInputRef.current?.focus();
  }, [search]);

  const startEditing = (id: number, currentValue: string) => {
    setEditingId(id);
    setEditValue(currentValue);
  };

  const saveEdit = () => {
    if (editingId !== null && editValue.trim()) {
      const id = editingId;
      const next = editValue.trim();
      // Original rewritten text — snapshot before the optimistic update.
      const original = history.find((entry) => entry.id === id)?.rewritten ?? "";
      void updateHistoryRewritten(id, next);
      toast.info(t("rewriteUpdated"));
      // After the persist call kicks off, diff old → new and offer to learn
      // any newly-introduced proper-noun-shaped words as vocabulary terms.
      // Gated on the Auto-add vocabulary preference (Settings → General).
      // Async + best-effort; failures (already-in-vocab UNIQUE collisions,
      // backend errors) are swallowed so we never block the user's edit flow.
      if (hotkeySettings.autoAddVocabulary) {
        void learnNewVocabTerms(original, next);
      }
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  return (
    <>
      {/* Flush toolbar: search + favorites filter */}
      <div className="tab-toolbar">
        <div
          className="flex h-8 items-center gap-2 rounded-md border px-3"
          style={{
            background: "var(--bg-elev-2)",
            borderColor: "var(--hairline)",
            color: "var(--text-muted)",
            width: 280,
          }}
        >
          <Search size={13} strokeWidth={2} />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchHistoryPlaceholder")}
            className="w-full bg-transparent text-[12px] outline-none"
            style={{ color: "var(--text)" }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              style={{ color: "var(--text-dim)" }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          className="btn"
          aria-label={showFavoritesOnly ? t("showAllDictationsLabel") : t("showOnlyFavoritesLabel")}
          aria-pressed={showFavoritesOnly}
          title={showFavoritesOnly ? t("showAllLabel") : t("showOnlyFavoritesLabel")}
          style={
            showFavoritesOnly
              ? {
                  background: "var(--bg-elev-3)",
                  borderColor: "var(--hairline-strong)",
                  color: "var(--amber)",
                  // Square button when icon-only — `.btn`'s 12px horizontal
                  // padding looks lopsided without text alongside. Also
                  // explicitly center the single child since `.btn` is
                  // `inline-flex` and defaults to flex-start, which would
                  // glue the star to the left edge of the 32px square.
                  padding: 0,
                  width: 32,
                  justifyContent: "center",
                }
              : { padding: 0, width: 32, justifyContent: "center" }
          }
        >
          <Star
            strokeWidth={2}
            fill={showFavoritesOnly ? "currentColor" : "none"}
          />
        </button>
        <div style={{ flex: 1 }} />
      </div>

      {filteredItems.length === 0 ? (
        <div className="page-scroll">
          <div className="page-body">
            <div className="empty">
              <p>{t("noHistoryItemsFound")}</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Table header lives OUTSIDE `.page-scroll` so the scrollbar
           * sits flush below it and the bottom hairline extends fully. */}
          <div className="page-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
            <div className="thead t-history">
              <div>{t("spokenLabel")}</div>
              <div>{t("rewrittenLabel")}</div>
              <div style={{ textAlign: "right" }}>{t("actionsLabel")}</div>
            </div>
          </div>

          <div className="page-scroll">
            <div className="page-body" style={{ paddingTop: 0 }}>
              {/* Flat row list — no date grouping. `filteredItems` is already
               * ordered newest-first by the store, so chronology reads top-down. */}
              {filteredItems.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <div key={item.id} className="trow t-history">
                    <div className="cell-spoken">{item.original}</div>
                    <div className="cell-rewritten">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValue}
                          autoFocus
                          onChange={(event) => setEditValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveEdit();
                            }
                            if (event.key === "Escape") {
                              cancelEdit();
                            }
                          }}
                          className="w-full rounded px-2 py-1 text-[13px] outline-none"
                          style={{
                            background: "var(--bg-elev-3)",
                            border: "1px solid oklch(0.65 0.17 var(--ai-h) / 0.4)",
                            color: "var(--text)",
                          }}
                        />
                      ) : (
                        item.rewritten
                      )}
                    </div>
                    <div className="cell-actions">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="grid size-[26px] place-items-center rounded-md"
                            style={{ color: "var(--ai)" }}
                            onClick={saveEdit}
                            title={t("save")}
                          >
                            <Check size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="grid size-[26px] place-items-center rounded-md"
                            style={{ color: "var(--text-dim)" }}
                            onClick={cancelEdit}
                            title={t("cancel")}
                          >
                            <X size={13} strokeWidth={2} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`grid size-[26px] place-items-center rounded-md fav-btn ${item.favorited ? "on" : ""}`}
                            onClick={() => {
                              toggleFavorite(item.id);
                              toast.info(
                                item.favorited
                                  ? t("dictationRemovedFromFavorites")
                                  : t("dictationAddedToFavorites"),
                              );
                            }}
                            title={item.favorited ? t("unstarLabel") : t("starLabel")}
                          >
                            <Star
                              size={13}
                              strokeWidth={2}
                              fill={item.favorited ? "currentColor" : "none"}
                            />
                          </button>
                          <button
                            type="button"
                            className="grid size-[26px] place-items-center rounded-md"
                            style={{ color: "var(--text-dim)" }}
                            onClick={() => startEditing(item.id, item.rewritten)}
                            title={t("edit")}
                          >
                            <Pencil size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="grid size-[26px] place-items-center rounded-md"
                            style={{ color: "var(--text-dim)" }}
                            onClick={() => {
                              void deleteHistoryItem(item.id);
                              toast.info(t("deletedFromHistory"));
                            }}
                            title={t("delete")}
                          >
                            <Trash2 size={13} strokeWidth={2} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
};
