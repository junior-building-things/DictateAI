import { useState } from "react";
import { BookOpen, Palette, Star, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Dropdown } from "../../components/Dropdown";
import { useI18n } from "../../lib/i18n";
import { useAppStore, rewriteToneOptions, type RewriteTone } from "../../lib/store";

/**
 * Settings → Rewrite Rules. Matches the design file's `rewrite:` panel:
 *   Group "Prompt":
 *     - Rewrite tone (plain dropdown)
 *     - Custom prompt (toggle in head + full-width textarea below; textarea
 *       is disabled when the toggle is off)
 *   Group "Context":
 *     - Use vocabulary (book icon + toggle)
 *     - Use favorites  (star icon + toggle)
 */
export const RewriteRules = () => {
  const { t } = useI18n();
  const { rewriteRules, setRewriteRules } = useAppStore();
  const [customDraft, setCustomDraft] = useState(rewriteRules.customPrompt);

  const getToneLabel = (tone: RewriteTone): string => {
    const map: Record<RewriteTone, string> = {
      neutral: t("toneNeutral"),
      casual: t("toneCasual"),
      friendly: t("toneFriendly"),
      professional: t("toneProfessional"),
      enthusiastic: t("toneEnthusiastic"),
    };
    return map[tone] || tone;
  };

  const onTone = (tone: RewriteTone) => {
    void setRewriteRules({ tone });
    toast.info(t("rewriteToneUpdatedToast", { tone: getToneLabel(tone) }));
  };

  const onToggleCustom = () => {
    // The toggle is a free flip — empty prompts are allowed; the rewrite
    // pipeline already treats a blank `customPrompt` as a no-op, so there's
    // no hazard in letting the toggle precede the text.
    const next = !rewriteRules.useCustomPrompt;
    void setRewriteRules({ useCustomPrompt: next });
    toast.info(next ? t("customPromptEnabledToast") : t("customPromptDisabledToast"));
  };

  const onToggleVocab = () => {
    const next = !rewriteRules.useVocabulary;
    void setRewriteRules({ useVocabulary: next });
    toast.info(next ? t("vocabularyEnabledToast") : t("vocabularyDisabledToast"));
  };

  const onToggleFavorites = () => {
    const next = !rewriteRules.useFavorites;
    void setRewriteRules({ useFavorites: next });
    toast.info(next ? t("favoritesEnabledToast") : t("favoritesDisabledToast"));
  };

  const onCustomBlur = () => {
    if (customDraft !== rewriteRules.customPrompt) {
      void setRewriteRules({ customPrompt: customDraft });
    }
  };

  return (
    <div>
      {/* Prompt */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">{t("promptTitle")}</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Palette strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("rewriteToneTitle")}</div>
            <div className="s-desc">{t("rewriteToneDescription")}</div>
          </div>
          <div className="s-control">
            <Dropdown<RewriteTone>
              value={rewriteRules.tone}
              options={rewriteToneOptions.map((tone) => ({
                value: tone,
                label: getToneLabel(tone),
              }))}
              onChange={(value) => onTone(value)}
            />
          </div>
        </div>

        <div className="s-row s-row-col">
          <div className="s-head-row">
            <div className="s-icon">
              <Wand2 strokeWidth={2} />
            </div>
            <div className="s-body">
              <div className="s-label">{t("customPromptLabel")}</div>
              <div className="s-desc">{t("useCustomPromptDescription")}</div>
            </div>
            <div className="s-control">
              <button
                type="button"
                aria-pressed={rewriteRules.useCustomPrompt}
                className={`toggle ${rewriteRules.useCustomPrompt ? "on" : ""}`}
                onClick={onToggleCustom}
              />
            </div>
          </div>
          {/* Textarea is always editable so the user can draft a prompt
           * before turning the toggle on. The toggle gates whether the
           * prompt is actually applied at rewrite-time, nothing more. */}
          <textarea
            className="s-textarea"
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            onBlur={onCustomBlur}
            placeholder={t("customPromptInputPlaceholder")}
            rows={4}
          />
        </div>
      </div>

      {/* Context */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">{t("contextTitle")}</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <BookOpen strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("useVocabularyTitle")}</div>
            <div className="s-desc">{t("useVocabularyDescription")}</div>
          </div>
          <div className="s-control">
            <button
              type="button"
              aria-pressed={rewriteRules.useVocabulary}
              className={`toggle ${rewriteRules.useVocabulary ? "on" : ""}`}
              onClick={onToggleVocab}
            />
          </div>
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Star strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">{t("useFavoritesTitle")}</div>
            <div className="s-desc">{t("useFavoritesDescription")}</div>
          </div>
          <div className="s-control">
            <button
              type="button"
              aria-pressed={rewriteRules.useFavorites}
              className={`toggle ${rewriteRules.useFavorites ? "on" : ""}`}
              onClick={onToggleFavorites}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
