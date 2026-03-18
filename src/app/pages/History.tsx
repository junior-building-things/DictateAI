import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  Pencil,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../lib/store";
import { cn } from "../../lib/utils";

export const History = () => {
  const { t } = useI18n();
  const { history, toggleFavorite, deleteHistoryItem, updateHistoryRewritten } = useAppStore();
  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const filteredItems = history.filter((item) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      item.original.toLowerCase().includes(query) ||
      item.rewritten.toLowerCase().includes(query);
    const matchesFilter = showFavoritesOnly ? item.favorited : true;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

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
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">{t("navHistory")}</h1>
          <p className="text-neutral-400">{t("historySubtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg border transition-all",
              showFavoritesOnly
                ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                : "border-white/[0.06] bg-[#161616] text-neutral-400 hover:bg-[#1b1b1b] hover:text-white",
            )}
          >
            <Star className={cn("h-4 w-4", showFavoritesOnly && "fill-current")} />
          </button>
          {isSearchOpen ? (
            <div className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.06] bg-[#161616] px-3 text-neutral-400 transition-all">
              <Search className="h-4 w-4 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => {
                  if (search.trim().length === 0) {
                    setIsSearchOpen(false);
                  }
                }}
                placeholder={t("searchHistoryPlaceholder")}
                className="w-44 bg-transparent text-sm text-white placeholder:text-neutral-600 focus:outline-none"
              />
              <button
                onClick={() => {
                  setSearch("");
                  setIsSearchOpen(false);
                }}
                className="text-neutral-500 transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsSearchOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.06] bg-[#161616] text-neutral-400 transition-all hover:bg-[#1b1b1b] hover:text-white"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="space-y-8">
        {filteredItems.map((item) => {
          const isEditing = editingId === item.id;

          return (
            <div
              key={item.id}
              className="group rounded-2xl border border-white/[0.06] bg-[#121212] p-6 transition-all duration-300 hover:border-white/[0.1] hover:bg-[#171717] hover:shadow-xl hover:shadow-black/20"
            >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1">
                      <Calendar className="h-3 w-3 text-neutral-500" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                        {item.date}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1">
                      <Clock className="h-3 w-3 text-neutral-500" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                        {item.time}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => {
                        toggleFavorite(item.id);
                        toast.info(
                          item.favorited
                            ? t("dictationRemovedFromFavorites")
                            : t("dictationAddedToFavorites"),
                        );
                      }}
                      className={cn(
                        "rounded-lg p-2 transition-all",
                        item.favorited
                          ? "bg-amber-500/10 text-amber-500"
                          : "text-neutral-500 hover:bg-white/[0.05] hover:text-white",
                      )}
                    >
                      <Star className={cn("h-4 w-4", item.favorited && "fill-current")} />
                    </button>
                    <button
                      onClick={() => {
                        void deleteHistoryItem(item.id);
                        toast.info(t("deletedFromHistory"));
                      }}
                      className="rounded-lg p-2 text-neutral-500 transition-all hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                      {t("spokenLabel")}
                    </p>
                    <p className="text-sm font-medium italic leading-relaxed text-neutral-400">
                      &quot;{item.original}&quot;
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-500">
                      {t("rewrittenLabel")}
                    </p>
                    {isEditing ? (
                      <textarea
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            saveEdit();
                          }
                          if (event.key === "Escape") {
                            cancelEdit();
                          }
                        }}
                        autoFocus
                        className="w-full resize-none rounded-xl border border-blue-500/30 bg-white/[0.03] p-3 text-base font-medium leading-relaxed text-white transition-all focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        rows={2}
                      />
                    ) : (
                      <p className="text-base font-medium leading-relaxed text-white">
                        {item.rewritten}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/[0.04] pt-4">
                  {isEditing ? (
                    <>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-white"
                      >
                        <X className="h-4 w-4" />
                        {t("cancel")}
                      </button>
                      <button
                        onClick={saveEdit}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
                      >
                        <Check className="h-4 w-4" />
                        {t("save")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEditing(item.id, item.rewritten)}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
                      >
                        <Pencil className="h-4 w-4" />
                        {t("edit")}
                      </button>
                    </>
                  )}
                </div>
            </div>
          );
        })}

        {filteredItems.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-neutral-500">{t("noHistoryItemsFound")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
