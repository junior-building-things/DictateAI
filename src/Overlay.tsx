import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X } from "lucide-react";
import { addVocabularyTerm, generatePhonetic } from "./lib/commands";

/**
 * The overlay window — same NSPanel-backed pill that previously showed
 * "Listening…" / "Rewriting…". The listening/rewriting UX was retired
 * in favor of inline placeholders, but the window and its plumbing
 * remain because they're the only thing we've gotten to reliably paint
 * above a focused fullscreen app on macOS (NSPanel +
 * FullScreenAuxiliary + setLevel:999).
 *
 * Today the overlay is used exclusively for the "Add 'Term' to
 * vocabulary?" prompt.
 *
 * Lifecycle:
 *   1. Backend `overlay::show_vocab(term)` stashes the term in
 *      `PendingVocabTerm` and emits `overlay-state` = `"vocab:<term>"`.
 *      We render the pill and arm a 15 s auto-dismiss.
 *   2. User clicks Add → generate phonetic, persist term, show
 *      "Added" for 1.2 s, ask backend to hide.
 *   3. User clicks × or timer fires → ask backend to hide.
 */

type OverlayState =
  | { kind: "vocab-ask"; term: string }
  | { kind: "vocab-saved"; term: string }
  | { kind: "vocab-error"; term: string; message: string };

const AUTO_DISMISS_MS = 15_000;
const POST_SAVE_HOLD_MS = 1_200;

export default function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null);

  useEffect(() => {
    let dismissTimer: number | null = null;
    let cancelled = false;

    const armDismiss = (delayMs: number) => {
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => {
        void invoke("hide_vocab_prompt").catch(() => undefined);
        setState(null);
      }, delayMs);
    };

    const handleVocabPayload = (term: string) => {
      if (!term) return;
      setState({ kind: "vocab-ask", term });
      armDismiss(AUTO_DISMISS_MS);
      // Phonetic generation is deferred to the Add click — we don't
      // burn an LLM call for terms the user is going to dismiss.
    };

    // Helper: drain PendingVocabTerm from the backend. Idempotent —
    // safe to call many times; if no term is pending it just returns
    // null and we no-op.
    const pullPendingTerm = () => {
      void invoke<string | null>("take_pending_vocab_term").then((term) => {
        if (cancelled) return;
        if (term) {
          void invoke("frontend_ping", {
            label: `overlay:pulled-term:${term}`,
          }).catch(() => undefined);
          handleVocabPayload(term);
        }
      });
    };

    pullPendingTerm();

    // Path 1: direct JS injection from Rust. When `show_vocab` runs on
    // the backend, it calls `WebviewWindow::eval` with
    // `window.__vocabWake()` — synchronous, bypasses every Tauri
    // event/messaging layer. We found Tauri events from a worker
    // thread don't reliably reach the overlay webview, so this is
    // the primary (fast) delivery mechanism.
    (window as unknown as { __vocabWake?: () => void }).__vocabWake = () => {
      pullPendingTerm();
    };

    // Path 2: polling. Every 300 ms, ask the backend if it has a
    // term waiting. Bulletproof fallback — if eval() somehow doesn't
    // fire either, polling will pick the term up within ~300 ms.
    // Cost: one invoke call per 300 ms = ~3/s, trivial.
    const pollHandle = window.setInterval(() => {
      pullPendingTerm();
    }, 300);

    return () => {
      cancelled = true;
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      window.clearInterval(pollHandle);
      delete (window as unknown as { __vocabWake?: () => void }).__vocabWake;
    };
  }, []);

  const dismiss = () => {
    void invoke("hide_vocab_prompt").catch(() => undefined);
    setState(null);
  };

  const onAdd = async () => {
    if (!state || state.kind !== "vocab-ask") return;
    const { term } = state;
    // No intermediate "Adding…" state — the pill stays in the ask
    // state while we generate the phonetic + persist, then flips
    // straight to "Added". The Add button gets a `data-saving`
    // attribute so we can grey it out in CSS without changing the
    // state machine.

    // Phonetic generation happens here, on the Add click — not on
    // pill display — so we only burn an LLM call for terms the user
    // actually wants to keep. The phonetic shows up in the Vocabulary
    // page in the main app; it's never shown in the pill itself.
    let phonetic: string | null = null;
    try {
      phonetic = await generatePhonetic(term);
    } catch {
      // Optional; persist without it.
    }
    try {
      await addVocabularyTerm(term, phonetic, null, "general");
      setState({ kind: "vocab-saved", term });
      window.setTimeout(dismiss, POST_SAVE_HOLD_MS);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = /UNIQUE|already exists|duplicate/i.test(raw)
        ? "Already in your vocabulary"
        : raw;
      setState({ kind: "vocab-error", term, message });
      window.setTimeout(dismiss, POST_SAVE_HOLD_MS * 2);
    }
  };

  if (!state) {
    // No content → render nothing. The window is transparent, so this
    // is invisible to the user. Same pattern as the old listening pill
    // when it was inert.
    return <div className="flex h-screen w-screen bg-transparent" />;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent select-none">
      <div className="flex items-center gap-2 rounded-full bg-[#050505]/95 px-3 py-1.5 shadow-lg">
        <div className="flex items-baseline gap-1.5 text-sm font-medium text-white whitespace-nowrap">
          {state.kind === "vocab-ask" && (
            <>
              <span className="text-white/60">Add</span>
              <span className="font-semibold">{state.term}</span>
              <span className="text-white/60">to vocabulary?</span>
            </>
          )}
          {state.kind === "vocab-saved" && (
            <>
              <span className="text-white/60">Added</span>
              <span className="font-semibold">{state.term}</span>
            </>
          )}
          {state.kind === "vocab-error" && (
            <>
              <span className="font-semibold">{state.term}</span>
              <span className="text-white/60">— {state.message}</span>
            </>
          )}
        </div>
        <div className="ml-1 flex items-center gap-1">
          {state.kind === "vocab-ask" && (
            <button
              type="button"
              onClick={() => void onAdd()}
              className="inline-flex items-center gap-1 rounded-full bg-blue-500/25 hover:bg-blue-500/40 border border-blue-400/40 px-2.5 py-0.5 text-xs font-medium text-blue-200 transition-colors"
              aria-label={`Add ${state.term} to vocabulary`}
            >
              <Plus size={11} strokeWidth={2.5} />
              Add
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="inline-grid place-items-center w-5 h-5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Dismiss"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
