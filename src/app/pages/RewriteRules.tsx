import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookText,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Circle,
  MessageCircle,
  Smile,
  Star,
  SunMedium,
  TextQuote,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../../lib/store";
import { cn } from "../../lib/utils";
import { rewriteToneOptions, type RewriteTone } from "../../lib/store";

export const RewriteRules = () => {
  const { rewriteRules, setRewriteRules } = useAppStore();
  const hasCustomPromptText = rewriteRules.customPrompt.trim().length > 0;

  const handleToggleCustomPrompt = () => {
    if (!hasCustomPromptText) {
      toast.error("Add a custom prompt first.");
      return;
    }

    const nextValue = !rewriteRules.useCustomPrompt;
    void setRewriteRules({ useCustomPrompt: nextValue });
    toast.info(nextValue ? "Custom prompt enabled." : "Custom prompt disabled.");
  };

  const handleToggleFavorites = () => {
    const nextValue = !rewriteRules.useFavorites;
    void setRewriteRules({ useFavorites: nextValue });
    toast.info(nextValue ? "Favorites enabled." : "Favorites disabled.");
  };

  const handleToggleVocabulary = () => {
    const nextValue = !rewriteRules.useVocabulary;
    void setRewriteRules({ useVocabulary: nextValue });
    toast.info(nextValue ? "Vocabulary enabled." : "Vocabulary disabled.");
  };

  const handleToneChange = (tone: RewriteTone) => {
    void setRewriteRules({ tone });
    toast.info(`Rewrite tone updated to ${toneLabel(tone)}.`);
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Rewrite Rules</h1>
        <p className="text-neutral-400">
          Customize how DictateAI cleans and rephrases your spoken words.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8">
        <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="flex items-center gap-3 border-b border-white/[0.06] pb-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <TextQuote className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Rewrite Tone</h2>
              <p className="text-sm text-neutral-500">
                Choose the tone used when DictateAI rewrites your text.
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-4">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              Tone
            </label>
            <ToneSelect
              value={rewriteRules.tone}
              onChange={handleToneChange}
            />
          </div>
        </section>

        <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <BookText className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Use Vocabulary</h2>
                <p className="text-sm text-neutral-500">
                  Use your saved terms to keep names, pronunciations, and terminology accurate.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleVocabulary}
              className={`h-6 w-12 shrink-0 rounded-full p-1 transition-all duration-300 ${
                rewriteRules.useVocabulary
                  ? "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.35)]"
                  : "bg-white/[0.1]"
              }`}
            >
              <div
                className={`h-4 w-4 rounded-full bg-white transition-all duration-300 ${
                  rewriteRules.useVocabulary ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </section>

        <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <Star className="h-5 w-5 fill-current text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Use Favorites</h2>
                <p className="text-sm text-neutral-500">
                  Reference your starred history items as rewrite examples.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleFavorites}
              className={`h-6 w-12 shrink-0 rounded-full p-1 transition-all duration-300 ${
                rewriteRules.useFavorites
                  ? "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.35)]"
                  : "bg-white/[0.1]"
              }`}
            >
              <div
                className={`h-4 w-4 rounded-full bg-white transition-all duration-300 ${
                  rewriteRules.useFavorites ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </section>

        <section className="space-y-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <Wand2 className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Use Custom Prompt</h2>
                <p className="text-sm text-neutral-500">
                  Add specific instructions for how DictateAI should rewrite your text.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleCustomPrompt}
              className={`h-6 w-12 shrink-0 rounded-full p-1 transition-all duration-300 ${
                rewriteRules.useCustomPrompt
                  ? "bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.35)]"
                  : "bg-white/[0.1]"
              }`}
            >
              <div
                className={`h-4 w-4 rounded-full bg-white transition-all duration-300 ${
                  rewriteRules.useCustomPrompt ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="h-px w-full bg-white/[0.08]" />

          <div className="space-y-4">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              Custom Prompt
            </label>
            <textarea
              value={rewriteRules.customPrompt}
              onChange={(event) => {
                const nextPrompt = event.target.value;
                void setRewriteRules({
                  customPrompt: nextPrompt,
                  useCustomPrompt:
                    nextPrompt.trim().length > 0
                      ? true
                      : false,
                });
              }}
              className="h-56 w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-sm text-neutral-300 transition-all placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              placeholder="You are a transcription post-processor. Your job is to clean up raw speech..."
            />
          </div>
        </section>
      </div>
    </div>
  );
};

const ToneSelect = ({
  value,
  onChange,
}: {
  value: RewriteTone;
  onChange: (value: RewriteTone) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white transition-all hover:bg-white/[0.05] focus:ring-1 focus:ring-blue-500/50"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ToneIcon tone={value} className="h-4 w-4 shrink-0 text-blue-400" />
          <span className="truncate capitalize">{toneLabel(value)}</span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-neutral-500 transition-transform", isOpen && "rotate-180")}
        />
      </button>
      <AnimatePresence>
        {isOpen ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 4, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute left-0 top-full z-50 w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#161616] py-1 shadow-2xl"
            >
              {rewriteToneOptions.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => {
                    onChange(tone);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-white"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ToneIcon tone={tone} className="h-4 w-4 shrink-0 text-blue-400" />
                    <span className="truncate capitalize">{toneLabel(tone)}</span>
                  </div>
                  {value === tone ? <Check className="h-4 w-4 text-blue-500" /> : null}
                </button>
              ))}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

function ToneIcon({
  tone,
  className,
}: {
  tone: RewriteTone;
  className?: string;
}) {
  const iconMap: Record<RewriteTone, LucideIcon> = {
    neutral: Circle,
    casual: MessageCircle,
    friendly: Smile,
    professional: BriefcaseBusiness,
    enthusiastic: SunMedium,
  };

  const Icon = iconMap[tone];
  return <Icon className={className} />;
}

function toneLabel(tone: RewriteTone) {
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}
