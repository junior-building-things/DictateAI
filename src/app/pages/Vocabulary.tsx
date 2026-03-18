import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Save, Trash2, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import {
  addVocabularyTerm,
  deleteVocabularyTerm,
  getVocabulary,
  updateVocabularyTerm,
} from "../../lib/commands";
import { useI18n } from "../../lib/i18n";
import type { VocabularyTerm } from "../../lib/types";

const emptyForm = {
  term: "",
  phonetic: "",
  definition: "",
};

export const Vocabulary = () => {
  const { t } = useI18n();
  const [terms, setTerms] = useState<VocabularyTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const topRef = useRef<HTMLDivElement | null>(null);
  const termInputRef = useRef<HTMLInputElement | null>(null);
  const phoneticInputRef = useRef<HTMLInputElement | null>(null);
  const definitionInputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = editingId !== null;
  const hasTerms = terms.length > 0;

  const actionLabel = useMemo(
    () => (isEditing ? t("saveChanges") : t("add")),
    [isEditing, t],
  );

  useEffect(() => {
    void loadTerms();
  }, []);

  const loadTerms = async () => {
    try {
      const nextTerms = await getVocabulary();
      setTerms(nextTerms);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToLoadVocabulary"));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    const term = form.term.trim();
    const phonetic = form.phonetic.trim();
    const definition = form.definition.trim();

    if (!term) {
      toast.error(t("enterTermFirst"));
      return;
    }

    setSaving(true);

    try {
      if (editingId === null) {
        await addVocabularyTerm(
          term,
          phonetic.length > 0 ? phonetic : null,
          definition.length > 0 ? definition : null,
          "general",
        );
        toast.info(t("vocabularyTermAdded"));
      } else {
        await updateVocabularyTerm(
          editingId,
          term,
          phonetic.length > 0 ? phonetic : null,
          definition.length > 0 ? definition : null,
          "general",
        );
        toast.info(t("vocabularyTermUpdated"));
      }

      resetForm();
      await loadTerms();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToSaveVocabularyTerm"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteVocabularyTerm(id);
      setTerms((previous) => previous.filter((term) => term.id !== id));
      if (editingId === id) {
        resetForm();
      }
      toast.info(t("vocabularyTermDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToDeleteVocabularyTerm"));
    }
  };

  const handleEdit = (term: VocabularyTerm) => {
    setEditingId(term.id);
    setForm({
      term: term.term,
      phonetic: term.phonetic ?? "",
      definition: term.definition ?? "",
    });
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      moveInputToEnd(termInputRef.current, true);
      moveInputToEnd(phoneticInputRef.current);
      moveInputToEnd(definitionInputRef.current);
    });
  };

  return (
    <div className="space-y-8">
      <header ref={topRef} className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">{t("navVocabulary")}</h1>
        <p className="text-neutral-400">{t("vocabularySubtitle")}</p>
      </header>

      <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-[#121212] p-8">
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                {t("termLabel")}
              </span>
              <input
                ref={termInputRef}
                type="text"
                placeholder={t("termPlaceholder")}
                value={form.term}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, term: event.target.value }))
                }
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-white transition-all placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
            </div>
            <Field
              label={t("phoneticPronunciationLabel")}
              placeholder={t("phoneticPlaceholder")}
              value={form.phonetic}
              onChange={(value) => setForm((previous) => ({ ...previous, phonetic: value }))}
              inputRef={phoneticInputRef}
            />
            <div className="space-y-2">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                {t("definitionLabel")}
              </span>
              <input
                ref={definitionInputRef}
                type="text"
                placeholder={t("definitionPlaceholder")}
                value={form.definition}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, definition: event.target.value }))
                }
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-white transition-all placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
              <div className="flex items-center justify-end gap-3 pt-2">
                {isEditing ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    <X className="h-4 w-4" />
                    {t("cancel")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {saving ? t("saving") : actionLabel}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6 border-t border-white/[0.06] pt-6">
            {loading ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-6 text-sm text-neutral-500">
                {t("loadingVocabulary")}
              </div>
            ) : null}

            {!loading && !hasTerms ? (
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-5 py-8 text-center text-sm text-neutral-500">
                {t("noVocabularyTermsYet")}
              </div>
            ) : null}

            {!loading ? (
              <div className="space-y-3">
                {terms.map((term) => (
                  <div
                    key={term.id}
                    className="flex items-start justify-between gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-semibold text-white">{term.term}</p>
                        {term.phonetic ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-300">
                            <Volume2 className="h-3.5 w-3.5" />
                            {term.phonetic}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm leading-relaxed text-neutral-400">
                        {term.definition || t("noDefinitionAdded")}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(term)}
                        className="rounded-lg p-2 text-neutral-400 transition-all hover:bg-white/[0.05] hover:text-white"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(term.id)}
                        className="rounded-lg p-2 text-neutral-400 transition-all hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
      </section>
    </div>
  );
};

const moveInputToEnd = (input: HTMLInputElement | null, focus = false) => {
  if (!input) {
    return;
  }

  if (focus) {
    input.focus();
  }

  const end = input.value.length;
  input.setSelectionRange(end, end);
  input.scrollLeft = input.scrollWidth;
};

const Field = ({
  label,
  placeholder,
  value,
  onChange,
  inputRef,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) => (
  <label className="block space-y-2">
    <span className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500">
      {label}
    </span>
    <input
      ref={inputRef}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-white transition-all placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
    />
  </label>
);
