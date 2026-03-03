import { useEffect, useState } from "react";
import { addVocabularyTerm, deleteVocabularyTerm, getVocabulary } from "../lib/commands";
import type { VocabularyTerm } from "../lib/types";

export default function PhraseMappingSettings() {
  const [items, setItems] = useState<VocabularyTerm[]>([]);
  const [phrase, setPhrase] = useState("");
  const [mappedTo, setMappedTo] = useState("");

  const load = async () => {
    const vocabulary = await getVocabulary();
    setItems(vocabulary);
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!phrase.trim()) return;
    await addVocabularyTerm(phrase.trim(), null, mappedTo.trim() || null, "phrase");
    setPhrase("");
    setMappedTo("");
    await load();
  };

  const remove = async (id: number) => {
    await deleteVocabularyTerm(id);
    await load();
  };

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-neutral-100">Custom vocabulary / phrase mapping</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Phrase"
          className="rounded-full border border-neutral-600 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-400"
        />
        <input
          value={mappedTo}
          onChange={(e) => setMappedTo(e.target.value)}
          placeholder="Map to (optional)"
          className="rounded-full border border-neutral-600 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-400"
        />
      </div>
      <button
        onClick={() => void add()}
        className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium text-black transition hover:bg-white"
      >
        Add
      </button>

      <div className="max-h-56 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-xl border border-neutral-700 bg-neutral-900 p-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-neutral-200">{item.term}</div>
              {item.definition && (
                <div className="truncate text-xs text-neutral-500">Mapped to: {item.definition}</div>
              )}
            </div>
            <button
              onClick={() => void remove(item.id)}
              className="rounded-full px-2 py-1 text-xs text-neutral-500 transition hover:bg-red-900/30 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
