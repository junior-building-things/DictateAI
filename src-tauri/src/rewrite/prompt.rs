use crate::db::vocabulary::VocabularyTerm;

const DEFAULT_SYSTEM_INSTRUCTION: &str = r#"You are the DictateAI transcription post-processor. Your ONLY job is to lightly clean up raw speech transcriptions into written text.

CRITICAL RULES — follow these strictly:
1. Make MINIMAL changes. Keep the user's original words as much as possible.
2. Only remove obvious filler words: um, uh, er, hmm, you know, like (when used as filler).
3. Remove obvious false starts and repeated words (e.g. "I I want" → "I want").
4. Fix obvious punctuation and capitalization.
5. Do NOT rephrase, restructure, or reword sentences.
6. Do NOT add any words that were not spoken.
7. Do NOT remove meaningful words — only fillers.
8. Do NOT change vocabulary, tone, or formality level.
9. Do NOT paraphrase. The output should be very close to the input, just cleaned up.
10. If the transcription is already clean, return it unchanged.
11. Use the vocabulary reference below for correct spelling of proper nouns and technical terms.
12. Output ONLY the cleaned text. No explanations, no preamble, no quotes, no markdown.

## Examples

Raw: "Hmm I see, but why do we need to relaunch it? Can't we just analyze the current performance? I mean the current data."
Cleaned: "I see. But why do we need to relaunch it? Can't we just analyze the current data?"

Raw: "Please help me update document A when you're done. Oh and also document B"
Cleaned: "Please help me update document A and B when you're done""#;

pub fn default_system_instruction() -> &'static str {
    DEFAULT_SYSTEM_INSTRUCTION
}

pub fn build_prompt(
    system_instruction: &str,
    raw_transcript: &str,
    vocabulary: &[VocabularyTerm],
) -> (String, String) {
    let mut system = if system_instruction.trim().is_empty() {
        String::from(DEFAULT_SYSTEM_INSTRUCTION)
    } else {
        system_instruction.to_string()
    };

    // Add vocabulary context
    if !vocabulary.is_empty() {
        system.push_str("\n\n## Vocabulary Reference\nThe user works with these specific terms. Always use the exact spelling shown:\n");
        for term in vocabulary {
            system.push_str(&format!("- {}", term.term));
            if let Some(ref phonetic) = term.phonetic {
                system.push_str(&format!(" (may sound like \"{}\")", phonetic));
            }
            if let Some(ref definition) = term.definition {
                system.push_str(&format!(": {}", definition));
            }
            system.push('\n');
        }
    }

    let user_message = format!(
        "Raw: \"{}\"",
        raw_transcript
    );

    (system, user_message)
}
