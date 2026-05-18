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

const emptyForm = { term: "", phonetic: "", definition: "" };

export const Vocabulary = () => {
  const { t } = useI18n();
  const [terms, setTerms] = useState<VocabularyTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const termInputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = editingId !== null;

  useEffect(() => {
    void loadTerms();
  }, []);

  const loadTerms = async () => {
    try {
      const next = await getVocabulary();
      setTerms(next);
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
          phonetic || null,
          definition || null,
          "general",
        );
        toast.info(t("vocabularyTermAdded"));
      } else {
        await updateVocabularyTerm(
          editingId,
          term,
          phonetic || null,
          definition || null,
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
      setTerms((previous) => previous.filter((entry) => entry.id !== id));
      if (editingId === id) resetForm();
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
    requestAnimationFrame(() => termInputRef.current?.focus());
  };

  const canSubmit = form.term.trim().length > 0 && !saving;

  const sortedTerms = useMemo(
    () => [...terms].sort((a, b) => a.term.localeCompare(b.term)),
    [terms],
  );

  return (
    <>
      {/* Flush add-row — full-width inline form pinned under the topbar */}
      <div className="add-term-row">
        <input
          ref={termInputRef}
          type="text"
          placeholder={t("termPlaceholder")}
          value={form.term}
          onChange={(event) => setForm((previous) => ({ ...previous, term: event.target.value }))}
        />
        <input
          type="text"
          placeholder={t("phoneticPlaceholder")}
          value={form.phonetic}
          onChange={(event) =>
            setForm((previous) => ({ ...previous, phonetic: event.target.value }))
          }
        />
        <input
          type="text"
          placeholder={t("definitionPlaceholder")}
          value={form.definition}
          onChange={(event) =>
            setForm((previous) => ({ ...previous, definition: event.target.value }))
          }
        />
        <div className="flex items-center gap-1.5">
          {isEditing && (
            <button type="button" onClick={resetForm} className="btn">
              <X strokeWidth={2} />
              {t("cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSubmit}
            className="btn btn-ai"
          >
            {isEditing ? <Save strokeWidth={2} /> : <Plus strokeWidth={2} />}
            {saving ? t("saving") : isEditing ? t("saveChanges") : t("add")}
          </button>
        </div>
      </div>

      <div className="page-body">
      {loading ? (
        <div className="empty">
          <p>{t("loadingVocabulary")}</p>
        </div>
      ) : sortedTerms.length === 0 ? (
        <div className="empty">
          <p>{t("noVocabularyTerms") ?? "No vocabulary terms yet."}</p>
        </div>
      ) : (
        <>
          <div className="thead t-vocab">
            <div>Term</div>
            <div>Phonetic</div>
            <div>Definition</div>
            <div>Category</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>
          {sortedTerms.map((term) => (
            <div key={term.id} className="trow t-vocab">
              <div className="cell-term">{term.term}</div>
              <div>
                {term.phonetic ? (
                  <span className="cell-pho">
                    <Volume2 size={10} strokeWidth={2} />
                    {term.phonetic}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-dim)", fontSize: 11.5 }}>—</span>
                )}
              </div>
              <div className="cell-def">{term.definition || "—"}</div>
              <div className="cell-added">{term.category}</div>
              <div className="cell-actions">
                <button
                  type="button"
                  className="grid size-[26px] place-items-center rounded-md"
                  style={{ color: "var(--text-dim)" }}
                  onClick={() => handleEdit(term)}
                  title="Edit"
                >
                  <Pencil size={13} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="grid size-[26px] place-items-center rounded-md"
                  style={{ color: "var(--text-dim)" }}
                  onClick={() => void handleDelete(term.id)}
                  title="Delete"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      </div>
    </>
  );
};
