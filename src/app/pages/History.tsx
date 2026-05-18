import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe, Pencil, Search, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "../../lib/i18n";
import { useAppStore, type HistoryItem } from "../../lib/store";

export const History = () => {
  const { t } = useI18n();
  const { history, toggleFavorite, deleteHistoryItem, updateHistoryRewritten } = useAppStore();
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

  // Group by date string for sticky-header table groups.
  const grouped = useMemo(() => groupByDate(filteredItems), [filteredItems]);

  useEffect(() => {
    if (search) searchInputRef.current?.focus();
  }, [search]);

  const startEditing = (id: number, currentValue: string) => {
    setEditingId(id);
    setEditValue(currentValue);
  };

  const saveEdit = () => {
    if (editingId !== null && editValue.trim()) {
      void updateHistoryRewritten(editingId, editValue.trim());
      toast.info(t("rewriteUpdated"));
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
          className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px]"
          style={{
            background: showFavoritesOnly ? "var(--bg-elev-3)" : "var(--bg-elev-2)",
            borderColor: showFavoritesOnly ? "var(--hairline-strong)" : "var(--hairline)",
            color: showFavoritesOnly ? "var(--amber)" : "var(--text-muted)",
          }}
        >
          <Star
            size={12}
            strokeWidth={2}
            fill={showFavoritesOnly ? "currentColor" : "none"}
          />
          Favorites
        </button>
        <div style={{ flex: 1 }} />
        <span className="mono-label" style={{ fontSize: "10.5px" }}>
          {filteredItems.length} {filteredItems.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="page-body">
      {filteredItems.length === 0 ? (
        <div className="empty">
          <p>{t("noHistoryItemsFound")}</p>
        </div>
      ) : (
        <>
          {/* Table header */}
          <div className="thead t-history">
            <div>Time</div>
            <div>Spoken</div>
            <div>Rewritten</div>
            <div style={{ textAlign: "right" }}>Words</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>

          {/* Date-grouped rows */}
          {grouped.map(({ date, items }) => (
            <div key={date}>
              <div className="tgroup-header">
                <span className="tgroup-pill">
                  <Globe size={10} strokeWidth={2} />
                  {date}
                </span>
                <span className="tgroup-count">{items.length}</span>
                <span className="tgroup-bar" />
              </div>
              {items.map((item) => {
                const isEditing = editingId === item.id;
                return (
                  <div key={item.id} className="trow t-history">
                    <div className="cell-time">{item.time}</div>
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
                    <div className="cell-words" style={{ textAlign: "right" }}>
                      {wordCount(item.rewritten || item.original)}w
                    </div>
                    <div className="cell-actions">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="grid size-[26px] place-items-center rounded-md"
                            style={{ color: "var(--ai)" }}
                            onClick={saveEdit}
                            title="Save"
                          >
                            <Check size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="grid size-[26px] place-items-center rounded-md"
                            style={{ color: "var(--text-dim)" }}
                            onClick={cancelEdit}
                            title="Cancel"
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
                            title={item.favorited ? "Unstar" : "Star"}
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
                            title="Edit"
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
                            title="Delete"
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
          ))}
        </>
      )}
      </div>
    </>
  );
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function groupByDate(items: HistoryItem[]) {
  const groups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const key = item.date || "Earlier";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
}
