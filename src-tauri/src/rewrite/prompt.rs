use crate::db::history::FavoriteRewriteExample;
use crate::db::vocabulary::VocabularyTerm;

const DEFAULT_SYSTEM_INSTRUCTION: &str = r#"You are a transcription post-processor. Your job is to lightly clean up raw speech transcriptions into written text.

CRITICAL RULES — follow these strictly:
1. Keep the user's original words as much as possible.
2. Remove filler words such as: um, uh, er, hmm, you know, and "like" when it does not change the meaning of the sentence.
3. Remove obvious false starts and repeated words (e.g. "I I want" -> "I want").
4. Remove spoken self-corrections or revisions where the speaker replaces earlier information. Keep only the final, corrected version.
5. If multiple phrases express the same idea with increasing precision, keep only the most specific or final version.
6. Use commas to represent natural pauses in the speech.
7. Do not add any periods anywhere in the output.
8. Use a neutral tone.
9. If the transcription is already clean, return it unchanged.
10. Output ONLY the cleaned text. No explanations, no preamble, no quotes, no markdown."#;

const BASE_SYSTEM_INSTRUCTION: &str = r#"You are a transcription post-processor. Your job is to lightly clean up raw speech transcriptions into written text.

CRITICAL RULES — follow these strictly:
1. Keep the user's original words as much as possible.
2. Remove filler words such as: um, uh, er, hmm, you know, and "like" when it does not change the meaning of the sentence.
3. Remove obvious false starts and repeated words (e.g. "I I want" -> "I want").
4. Remove spoken self-corrections or revisions where the speaker replaces earlier information. Keep only the final, corrected version.
5. If multiple phrases express the same idea with increasing precision, keep only the most specific or final version.
6. Use commas to represent natural pauses in the speech.
7. Do not add any periods anywhere in the output."#;

pub fn default_system_instruction() -> &'static str {
    DEFAULT_SYSTEM_INSTRUCTION
}

pub fn system_instruction_for_tone(tone: &str) -> String {
    let normalized = normalize_tone(tone);
    if normalized == "neutral" {
        return DEFAULT_SYSTEM_INSTRUCTION.to_string();
    }

    format!(
        "{BASE_SYSTEM_INSTRUCTION}\n8. {}\n9. If the transcription is already clean, return it unchanged.\n10. Output ONLY the cleaned text. No explanations, no preamble, no quotes, no markdown.",
        tone_instruction(normalized)
    )
}

pub fn build_prompt(
    system_instruction: &str,
    raw_transcript: &str,
    vocabulary: &[VocabularyTerm],
    favorite_examples: &[FavoriteRewriteExample],
) -> (String, String) {
    let mut system = if system_instruction.trim().is_empty() {
        String::from(DEFAULT_SYSTEM_INSTRUCTION)
    } else {
        system_instruction.to_string()
    };

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

    if !favorite_examples.is_empty() {
        system.push_str(
            "\n\n## Favorite Rewrite Examples\nUse these starred examples as style guidance for future rewrites. Preserve the current transcript's meaning and do not copy phrasing unless it naturally fits.\n",
        );
        for example in favorite_examples {
            system.push_str(&format!(
                "- Raw: \"{}\"\n  Rewritten: \"{}\"\n",
                example.raw_text, example.rewritten
            ));
        }
    }

    let user_message = format!("Raw: \"{}\"", raw_transcript);

    (system, user_message)
}

fn normalize_tone(tone: &str) -> &str {
    let normalized = tone.trim().to_lowercase();
    match normalized.as_str() {
        "casual" => "casual",
        "friendly" => "friendly",
        "confident" => "professional",
        "professional" => "professional",
        "enthusiastic" => "enthusiastic",
        _ => "neutral",
    }
}

fn tone_instruction(tone: &str) -> &'static str {
    match tone {
        "casual" => "Use a casual, conversational tone.",
        "friendly" => "Use a warm, friendly tone.",
        "professional" => "Use a clear, professional tone.",
        "enthusiastic" => "Use an energetic, enthusiastic tone.",
        _ => "Use a neutral tone.",
    }
}
