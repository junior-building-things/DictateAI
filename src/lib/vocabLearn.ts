import { invoke } from "@tauri-apps/api/core";

/**
 * "Learn from corrections" — diff a pasted dictation against a user's
 * edited version, and for each new proper-noun-shaped word, pop a toast
 * prompting the user to add it to the vocabulary.
 *
 * Called from two places:
 *   1. History tab inline edit save (user fixes a transcription in DictateAI).
 *   2. `dictation-edited` Tauri event (backend AX-watches the focused
 *      element after a paste and fires when it sees a user-edit-in-place
 *      in the destination app).
 *
 * Both paths feed into the same toast-prompt → confirm → generate-phonetic
 * → add flow.
 *
 * Heuristics — kept deliberately simple, since false positives only cost
 * the user a dismiss-click but false *negatives* cost a repeated
 * correction. The bias is toward surfacing the next "Seedream":
 *
 *   - case-insensitive word diff (so "the" → "The" isn't treated as new)
 *   - mid-CamelCase ("OAuth", "iPhone")        → keep
 *   - ALL CAPS with optional digit ("AWS", "S3") → keep
 *   - Capitalized words ≥4 chars, not in the small stopword list  → keep
 *   - everything else (lowercase, short, sentence-starters)        → skip
 */
export function learnNewVocabTerms(oldText: string, newText: string): void {
  const candidates = extractNewProperNouns(oldText, newText);
  // Visible-from-the-terminal trace: the backend logs every step of the
  // detection pipeline; this lets us see whether the frontend side
  // received the event and what proper-noun candidates fell out of the
  // diff. If you see "Edit monitor: send detected" in the Rust log but
  // no "[vocab-learn]" lines, the dictation-edited event isn't reaching
  // the React listener.
  // eslint-disable-next-line no-console
  console.log(
    `[vocab-learn] diff baseline=${oldText.length} chars / edited=${newText.length} chars / candidates=${JSON.stringify(candidates)}`,
  );
  for (const term of candidates) {
    void invoke("show_vocab_prompt", { term });
  }
}

function extractNewProperNouns(oldText: string, newText: string): string[] {
  const wordRegex = /[A-Za-z][A-Za-z0-9]*/g;
  const oldWordsLower = new Set(
    (oldText.match(wordRegex) ?? []).map((w) => w.toLowerCase()),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of newText.match(wordRegex) ?? []) {
    const lower = word.toLowerCase();
    if (oldWordsLower.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    if (looksLikeProperNoun(word)) out.push(word);
  }
  return out;
}

/** Common capitalized English words that aren't worth learning even if
 * they're "new" relative to the prior text — usually they appear because
 * the user reworded a sentence, not because they're a domain term. */
const PROPER_NOUN_STOPWORDS = new Set([
  "This", "That", "These", "Those", "Their", "There", "They", "Them",
  "Then", "Than", "What", "When", "Where", "Which", "While", "Whose",
  "Whom", "About", "After", "Again", "Also", "Always", "Another",
  "Before", "Because", "Being", "Could", "Every", "First", "Going",
  "Have", "Having", "Hello", "However", "Maybe", "Might", "Most",
  "Much", "Other", "Should", "Some", "Something", "Sometimes", "Still",
  "Such", "Sure", "Through", "Today", "Tomorrow", "Very",
  "Want", "Will", "With", "Would", "Yesterday", "Your",
]);

function looksLikeProperNoun(word: string): boolean {
  if (word.length < 3) return false;
  const hasUpper = /[A-Z]/.test(word);
  if (!hasUpper) return false;
  const hasLower = /[a-z]/.test(word);
  const hasDigit = /\d/.test(word);
  // CamelCase / mixedCase like "OAuth", "iPhone", "kubectl3"
  if (hasUpper && hasLower) {
    if (/[A-Z]/.test(word.slice(1)) || /^[a-z]/.test(word)) return true;
  }
  // ALL CAPS, optionally with digits — "AWS", "API", "S3"
  if (/^[A-Z]+\d*$/.test(word) && word.length >= 2) return true;
  // Has a digit anywhere — likely a model name / version / SKU
  if (hasDigit) return true;
  // Plain capitalized word, ≥4 chars, not on stopword list
  if (/^[A-Z][a-z]+$/.test(word) && word.length >= 4) {
    return !PROPER_NOUN_STOPWORDS.has(word);
  }
  return false;
}
