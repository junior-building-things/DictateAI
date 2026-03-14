import { useEffect, useState } from "react";
import {
  getVocabulary,
  addVocabularyTerm,
  deleteVocabularyTerm,
  updateVocabularyTerm,
} from "../lib/commands";
import type { VocabularyTerm } from "../lib/types";
import { useI18n } from "../lib/i18n";

export default function VocabularyManager() {
  const { t } = useI18n();
  const [terms, setTerms] = useState<VocabularyTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    term: "",
    phonetic: "",
      definition: "",
      category: "general",
  });

  useEffect(() => {
    void loadTerms();
  }, []);

  const loadTerms = async () => {
    const data = await getVocabulary();
    setTerms(data);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!form.term.trim()) return;
    await addVocabularyTerm(form.term, form.phonetic || null, form.definition || null, form.category);
    resetForm();
    await loadTerms();
  };

  const handleUpdate = async () => {
    if (!editingId || !form.term.trim()) return;
    await updateVocabularyTerm(editingId, form.term, form.phonetic || null, form.definition || null, form.category);
    resetForm();
    await loadTerms();
  };

  const handleDelete = async (id: number) => {
    await deleteVocabularyTerm(id);
    await loadTerms();
  };

  const startEdit = (term: VocabularyTerm) => {
    setEditingId(term.id);
    setForm({
      term: term.term,
      phonetic: term.phonetic || "",
      definition: term.definition || "",
      category: term.category,
    });
    setShowAdd(true);
  };

  const resetForm = () => {
    setForm({ term: "", phonetic: "", definition: "", category: "general" });
    setShowAdd(false);
    setEditingId(null);
  };

  if (loading) return <div className="p-6 text-sm text-neutral-500">{t("loading")}</div>;

  return (
    <section className="space-y-6">
      <div className="surface-card space-y-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <h3 className="section-title">{t("customVocabulary")}</h3>
            <p className="field-help">{t("customVocabularyDesc")}</p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowAdd(!showAdd);
            }}
            className="btn-primary"
          >
            {showAdd ? t("cancel") : t("addPhrase")}
          </button>
        </div>

        {showAdd && (
          <div className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-4">
            <input
              placeholder={t("termPlaceholder")}
              value={form.term}
              onChange={(e) => setForm({ ...form, term: e.target.value })}
              className="input-control"
            />
            <input
              placeholder={t("phoneticPlaceholder")}
              value={form.phonetic}
              onChange={(e) => setForm({ ...form, phonetic: e.target.value })}
              className="input-control"
            />
            <input
              placeholder={t("definitionPlaceholder")}
              value={form.definition}
              onChange={(e) => setForm({ ...form, definition: e.target.value })}
              className="input-control"
            />
            <button
              onClick={() => void (editingId ? handleUpdate() : handleAdd())}
              className="btn-primary"
            >
              {editingId ? t("updatePhrase") : t("addPhrase")}
            </button>
          </div>
        )}
        <div className="space-y-3">
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {terms.length === 0 ? (
              <p className="py-4 text-center text-sm text-neutral-500">
                {t("noVocabulary")}
              </p>
            ) : (
              terms.map((term) => (
                <div
                  key={term.id}
                  className="flex items-center justify-between rounded-2xl border border-neutral-800 bg-neutral-950/65 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-neutral-100">{term.term}</div>
                    <div className="mt-1 truncate text-xs text-neutral-500">
                      {term.phonetic && `${t("soundsLike")} "${term.phonetic}"`}
                      {term.phonetic && term.definition && " | "}
                      {term.definition && `${term.definition}`}
                    </div>
                  </div>
                  <div className="ml-2 flex gap-1">
                    <button
                      onClick={() => startEdit(term)}
                      className="rounded-lg border border-transparent px-2 py-1 text-xs text-neutral-500 transition hover:border-neutral-600 hover:bg-neutral-900/80 hover:text-neutral-100"
                    >
                      {t("edit")}
                    </button>
                    <button
                      onClick={() => void handleDelete(term.id)}
                      className="rounded-lg border border-transparent px-2 py-1 text-xs text-neutral-500 transition hover:border-red-700/50 hover:bg-red-900/30 hover:text-red-300"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

        </div>
      </div>
    </section>
  );
}
