import { useState } from "react";
import { BookOpen, Palette, Star, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Dropdown } from "../../components/Dropdown";
import { useI18n } from "../../lib/i18n";
import { useAppStore, rewriteToneOptions, type RewriteTone } from "../../lib/store";

const TONE_LABEL: Record<RewriteTone, string> = {
  neutral: "Neutral",
  casual: "Casual",
  friendly: "Friendly",
  professional: "Professional",
  enthusiastic: "Enthusiastic",
};

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
  const hasCustomText = customDraft.trim().length > 0;

  const onTone = (tone: RewriteTone) => {
    void setRewriteRules({ tone });
    toast.info(t("rewriteToneUpdatedToast", { tone: TONE_LABEL[tone] }));
  };

  const onToggleCustom = () => {
    if (!hasCustomText) {
      toast.error(t("addCustomPromptFirst"));
      return;
    }
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
            <span className="title">Prompt</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <Palette strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Rewrite tone</div>
            <div className="s-desc">Define the general tone of the rewrite.</div>
          </div>
          <div className="s-control">
            <Dropdown<RewriteTone>
              value={rewriteRules.tone}
              options={rewriteToneOptions.map((tone) => ({
                value: tone,
                label: TONE_LABEL[tone],
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
              <div className="s-label">Custom prompt</div>
              <div className="s-desc">Add specific rewrite instructions.</div>
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
          <textarea
            className="s-textarea"
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            onBlur={onCustomBlur}
            disabled={!rewriteRules.useCustomPrompt}
            placeholder="e.g. 'Match my casual voice in Slack. Use sentence case.'"
            rows={4}
          />
        </div>
      </div>

      {/* Context */}
      <div className="s-group">
        <div className="s-group-head">
          <div className="title-wrap">
            <span className="title">Context</span>
          </div>
          <div className="bar" />
        </div>

        <div className="s-row">
          <div className="s-icon">
            <BookOpen strokeWidth={2} />
          </div>
          <div className="s-body">
            <div className="s-label">Use vocabulary</div>
            <div className="s-desc">Reference your vocabulary during rewrite.</div>
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
            <div className="s-label">Use favorites</div>
            <div className="s-desc">Reference your starred history during rewrite.</div>
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
