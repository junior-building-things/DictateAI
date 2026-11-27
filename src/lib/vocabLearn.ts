import { addVocabularyTerm, filterUnknownVocabularyTerms, getVocabulary } from "./commands";

/**
 * "Learn from corrections" — diff a pasted dictation against the user's
 * edited version and silently add the corrected words to the vocabulary, so
 * the next dictation gets them right.
 *
 * Called from two places:
 *   1. History tab inline edit save (user fixes a transcription in DictateAI).
 *   2. `dictation-edited` Tauri event (backend AX-watches the focused element
 *      after a paste and fires when it sees a user-edit-in-place in the
 *      destination app).
 *
 * Align the word sequences and keep spelling-similar substitutions, then
 * reject words recognized by the system dictionary. Spelling similarity
 * alone cannot distinguish misheard names from ordinary grammar edits.
 */

const MIN_TERM_LENGTH = 3;

/**
 * Normalized edit distance above which a substitution is treated as an
 * unrelated word swap rather than a corrected mis-hearing. 0.65 keeps
 * phonetic near-misses ("Shunade" -> "Sinead" is 4/7 = 0.57) while rejecting
 * genuine rewordings.
 */
const MAX_NORMALIZED_DISTANCE = 0.65;

/**
 * If more than this fraction of the original words were substituted, the user
 * rewrote the text rather than correcting it — learn nothing.
 */
const REWRITE_RATIO_LIMIT = 0.5;

/**
 * Everyday words a user corrects for grammar, not because the transcriber
 * misheard a name (their -> there, then -> than). Reject these regardless of
 * capitalization before consulting the system dictionary for other words.
 */
const COMMON_WORDS = new Set(
  (
    "the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use " +
    "their there they're theyre then than your you're youre it's were where wear we're hear here know knew right write whether weather which witch " +
    "affect effect accept except lose loose four buy bye won hour wait weight week weak piece peace break brake quite quiet " +
    "this that with have from they will would there what about which when make like time just him into year good some could them other " +
    "only come over think also back after work first well even want because any these give most"
  ).split(" "),
);

/** Category stamped on auto-learned terms, so their origin stays visible. */
const LEARNED_CATEGORY = "learned";

/** Levenshtein edit distance. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Split into words, stripping leading/trailing punctuation. */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, ""))
    .filter((word) => word.length > 0);
}

/**
 * Narrow `fieldValue` to the part that corresponds to what we pasted. The AX
 * path hands us the *whole* focused field, which may contain paragraphs the
 * user wrote themselves; diffing against all of it would read their existing
 * prose as corrections.
 */
function findEditedRegion(originalText: string, fieldValue: string): string | null {
  if (fieldValue.includes(originalText)) return originalText;
  if (fieldValue.length <= originalText.length * 1.5) return fieldValue;

  const origWords = tokenize(originalText);
  const fieldWords = tokenize(fieldValue);
  const windowSize = origWords.length;
  if (windowSize === 0 || fieldWords.length <= windowSize) return fieldValue;

  // Slide a window the size of the pasted text and keep the best word overlap.
  let bestStart = 0;
  let bestScore = -1;
  let bestMatches = 0;
  for (let i = 0; i <= fieldWords.length - windowSize; i++) {
    let matches = 0;
    for (let j = 0; j < windowSize; j++) {
      if (fieldWords[i + j].toLowerCase() === origWords[j].toLowerCase()) matches++;
    }
    if (matches > bestScore) {
      bestScore = matches;
      bestStart = i;
      bestMatches = 1;
    } else if (matches === bestScore) {
      bestMatches++;
    }
  }

  // Silent learning must not guess between passages or unrelated text.
  if (bestScore < windowSize * 0.5 || bestMatches !== 1) return null;
  return fieldWords.slice(bestStart, bestStart + windowSize).join(" ");
}

/**
 * Word-level LCS alignment. Each run of dropped and inserted words between
 * two matches is read as substitutions when the counts agree, paired in
 * order — so correcting two adjacent words ("Shunade O'Conner" -> "Sinead
 * O'Connor") yields both pairs.
 */
function findSubstitutions(origWords: string[], editedWords: string[]) {
  const m = origWords.length;
  const n = editedWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const aligned: [string | null, string | null][] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1].toLowerCase() === editedWords[j - 1].toLowerCase()) {
      aligned.unshift([origWords[i - 1], editedWords[j - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      aligned.unshift([null, editedWords[j - 1]]);
      j--;
    } else {
      aligned.unshift([origWords[i - 1], null]);
      i--;
    }
  }

  const subs: [string, string][] = [];
  let dropped: string[] = [];
  let inserted: string[] = [];
  const flush = () => {
    if (dropped.length === inserted.length) {
      dropped.forEach((word, index) => subs.push([word, inserted[index]]));
    }
    dropped = [];
    inserted = [];
  };
  for (const [origWord, editedWord] of aligned) {
    if (origWord !== null && editedWord !== null) {
      flush();
    } else if (origWord !== null) {
      dropped.push(origWord);
    } else if (editedWord !== null) {
      inserted.push(editedWord);
    }
  }
  flush();
  return { subs, unchanged: dp[m][n] };
}

/**
 * Candidate corrections from an edit. The app's `learnNewVocabTerms` also
 * checks the system dictionary before adding them.
 */
export function extractCorrections(
  originalText: string,
  fieldValue: string,
  existingTerms: string[],
): string[] {
  if (!originalText || !fieldValue || originalText === fieldValue) return [];

  const editedRegion = findEditedRegion(originalText, fieldValue);
  if (editedRegion === null || editedRegion === originalText) return [];

  const origWords = tokenize(originalText);
  const editedWords = tokenize(editedRegion);
  if (origWords.length === 0 || editedWords.length === 0) return [];

  const { subs, unchanged } = findSubstitutions(origWords, editedWords);
  if (
    subs.length > origWords.length * REWRITE_RATIO_LIMIT ||
    unchanged < origWords.length * 0.5
  ) return [];

  const known = new Set(existingTerms.map((term) => term.toLowerCase()));
  const seen = new Set<string>();
  const learned: string[] = [];

  for (const [origWord, correctedWord] of subs) {
    const normalized = correctedWord.toLowerCase();
    if (known.has(normalized) || seen.has(normalized)) continue;
    if (origWord.toLowerCase() === normalized) continue;
    if (correctedWord.length < MIN_TERM_LENGTH) continue;
    if (COMMON_WORDS.has(normalized)) continue;

    const distance = editDistance(origWord.toLowerCase(), normalized);
    const maxLength = Math.max(origWord.length, correctedWord.length);
    if (distance / maxLength > MAX_NORMALIZED_DISTANCE) continue;

    learned.push(correctedWord);
    seen.add(normalized);
  }

  return learned;
}

/**
 * Diff a dictation against the user's edit and add whatever it corrected to
 * the vocabulary. Silent by design — no prompt, no toast. The terms show up
 * in the Vocabulary tab and feed the rewrite prompt on the next dictation.
 */
export async function learnNewVocabTerms(
  originalText: string,
  fieldValue: string,
): Promise<void> {
  let existingTerms: string[] = [];
  try {
    existingTerms = (await getVocabulary()).map((entry) => entry.term);
  } catch (error) {
    console.log(`[vocab-learn] could not read vocabulary, skipping: ${String(error)}`);
    return;
  }

  const candidates = extractCorrections(originalText, fieldValue, existingTerms);
  if (candidates.length === 0) return;

  let corrections: string[];
  try {
    corrections = await filterUnknownVocabularyTerms(candidates);
  } catch (error) {
    console.log(`[vocab-learn] dictionary unavailable, skipping: ${String(error)}`);
    return;
  }
  console.log(
    `[vocab-learn] baseline=${originalText.length} chars / edited=${fieldValue.length} chars / learned=${JSON.stringify(corrections)}`,
  );

  for (const term of corrections) {
    try {
      // No phonetic: generating one costs an LLM round trip per correction,
      // and the term itself is what the rewrite prompt needs. Users can add
      // a phonetic by hand in the Vocabulary tab.
      await addVocabularyTerm(term, null, null, LEARNED_CATEGORY);
    } catch (error) {
      // A duplicate (UNIQUE on term) or a write failure shouldn't stop the
      // rest of the batch.
      console.log(`[vocab-learn] could not add "${term}": ${String(error)}`);
    }
  }
}
