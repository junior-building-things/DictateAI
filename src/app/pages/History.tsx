import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
import { useAppStore } from "../../lib/store";
import { cn } from "../../lib/utils";

export const History = () => {
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
      toast.info("Rewrite updated.");
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
          <h1 className="text-3xl font-bold tracking-tight text-white">History</h1>
          <p className="text-neutral-400">Review and edit recent dictations.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg border transition-all",
              showFavoritesOnly
                ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                : "border-white/[0.06] bg-white/[0.03] text-neutral-400 hover:bg-white/[0.05] hover:text-white",
            )}
          >
            <Star className={cn("h-4 w-4", showFavoritesOnly && "fill-current")} />
          </button>
          {isSearchOpen ? (
            <div className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 text-neutral-400 transition-all">
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
                placeholder="Search history..."
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
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-neutral-400 transition-all hover:bg-white/[0.05] hover:text-white"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="space-y-8">
        <AnimatePresence mode="popLayout">
          {filteredItems.map((item) => {
            const isEditing = editingId === item.id;

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="group rounded-2xl border border-white/[0.04] bg-white/[0.02] p-6 transition-all duration-300 hover:border-white/[0.08] hover:bg-white/[0.03] hover:shadow-xl hover:shadow-black/20"
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
                            ? "Dictation removed from favorites."
                            : "Dictation added to favorites.",
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
                        toast.info("Deleted from history.");
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
                      Spoken
                    </p>
                    <p className="text-sm font-medium italic leading-relaxed text-neutral-400">
                      &quot;{item.original}&quot;
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-500">
                      Rewritten
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
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
                      >
                        <Check className="h-4 w-4" />
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEditing(item.id, item.rewritten)}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500"
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filteredItems.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-neutral-500">No history items found.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
