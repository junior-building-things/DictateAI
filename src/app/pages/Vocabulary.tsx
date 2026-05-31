import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Save, Search, Trash2, Volume2, X } from "lucide-react";
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
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const termInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isEditing = editingId !== null;

  useEffect(() => {
    void loadTerms();
  }, []);

  // Auto-focus the term input each time the modal opens (both for "add"
  // and "edit" flows, since opening is the only state transition where
  // focus matters).
  useEffect(() => {
    if (modalOpen) {
      requestAnimationFrame(() => termInputRef.current?.focus());
    }
  }, [modalOpen]);

  // ESC closes the modal — common dialog affordance.
  useEffect(() => {
    if (!modalOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modalOpen]);

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

  const openAddModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEditModal = (term: VocabularyTerm) => {
    setEditingId(term.id);
    setForm({
      term: term.term,
      phonetic: term.phonetic ?? "",
      definition: term.definition ?? "",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
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
    // Phonetic is now required too — promotes consistent pronunciation
    // hints for every entry, which is the main reason the table exists.
    if (!phonetic) {
      toast.error(t("enterPhoneticFirst"));
      return;
    }
    setSaving(true);
    try {
      if (editingId === null) {
        await addVocabularyTerm(
          term,
          phonetic,
          definition || null,
          "general",
        );
        toast.info(t("vocabularyTermAdded"));
      } else {
        await updateVocabularyTerm(
          editingId,
          term,
          phonetic,
          definition || null,
          "general",
        );
        toast.info(t("vocabularyTermUpdated"));
      }
      closeModal();
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
      if (editingId === id) closeModal();
      toast.info(t("vocabularyTermDeleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unableToDeleteVocabularyTerm"));
    }
  };

  const canSubmit =
    form.term.trim().length > 0 && form.phonetic.trim().length > 0 && !saving;

  // Sort newest-first by `created_at`, then filter by search across term /
  // phonetic / definition (mirrors History's spoken+rewritten search shape).
  // Newest-first matches History's ordering and lets the user see their
  // most-recent additions without scrolling.
  const visibleTerms = useMemo(() => {
    const sorted = [...terms].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    const query = search.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter(
      (entry) =>
        entry.term.toLowerCase().includes(query) ||
        (entry.phonetic ?? "").toLowerCase().includes(query) ||
        (entry.definition ?? "").toLowerCase().includes(query),
    );
  }, [terms, search]);

  return (
    <>
      {/* Search + Add toolbar (replaces the flush add-row). Search shape
       * matches the History tab for consistency; Add button on the right
       * opens the modal dialog below. */}
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
            placeholder={t("searchVocabularyPlaceholder")}
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
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ai" onClick={openAddModal}>
          <Plus strokeWidth={2} />
          {t("add")}
        </button>
      </div>

      {loading ? (
        <div className="page-scroll">
          <div className="page-body">
            <div className="empty">
              <p>{t("loadingVocabulary")}</p>
            </div>
          </div>
        </div>
      ) : visibleTerms.length === 0 ? (
        <div className="page-scroll">
          <div className="page-body">
            <div className="empty">
              <p>
                {terms.length === 0
                  ? t("noVocabularyTermsYet")
                  : t("noVocabularyMatch")}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Header lives outside the scroll wrapper — scrollbar sits below it. */}
          <div className="page-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
            <div className="thead t-vocab">
              <div>{t("termLabel")}</div>
              <div>{t("phoneticLabel")}</div>
              <div>{t("definitionLabel")}</div>
              <div style={{ textAlign: "right" }}>{t("actionsLabel")}</div>
            </div>
          </div>
          <div className="page-scroll">
            <div className="page-body" style={{ paddingTop: 0 }}>
          {visibleTerms.map((term) => (
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
              <div className="cell-actions">
                <button
                  type="button"
                  className="grid size-[26px] place-items-center rounded-md"
                  style={{ color: "var(--text-dim)" }}
                  onClick={() => openEditModal(term)}
                  title={t("edit")}
                >
                  <Pencil size={13} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="grid size-[26px] place-items-center rounded-md"
                  style={{ color: "var(--text-dim)" }}
                  onClick={() => void handleDelete(term.id)}
                  title={t("delete")}
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            </div>
          ))}
            </div>
          </div>
        </>
      )}

      {/* Add / edit modal. Renders unconditionally — visibility is driven
       * by the `.open` class so the CSS transition can run on enter/exit. */}
      <div
        className={`modal-overlay ${modalOpen ? "open" : ""}`}
        role="presentation"
        onMouseDown={(event) => {
          // Click on backdrop (not on modal body) closes the modal.
          if (event.target === event.currentTarget) closeModal();
        }}
      >
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vocab-modal-title"
        >
          <div className="modal-header">
            <div id="vocab-modal-title" className="modal-title">
              {isEditing ? t("saveChanges") : t("add")}
            </div>
            <button
              type="button"
              className="modal-close"
              onClick={closeModal}
              aria-label={t("close")}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="modal-body">
            <label className="modal-field">
              <span className="modal-label">
                {t("termLabel")} <span className="modal-required">*</span>
              </span>
              <input
                ref={termInputRef}
                type="text"
                placeholder={t("termPlaceholder")}
                value={form.term}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, term: event.target.value }))
                }
              />
            </label>
            <label className="modal-field">
              <span className="modal-label">
                {t("phoneticLabel")} <span className="modal-required">*</span>
              </span>
              <input
                type="text"
                placeholder={t("phoneticPlaceholder")}
                value={form.phonetic}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, phonetic: event.target.value }))
                }
              />
            </label>
            <label className="modal-field">
              <span className="modal-label">{t("definitionLabel")}</span>
              <input
                type="text"
                placeholder={t("definitionPlaceholder")}
                value={form.definition}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, definition: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={closeModal}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn btn-ai"
              disabled={!canSubmit}
              onClick={() => void handleSave()}
            >
              {isEditing ? <Save strokeWidth={2} /> : <Plus strokeWidth={2} />}
              {saving ? t("saving") : isEditing ? t("saveChanges") : t("add")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
