use crate::db::history::FavoriteRewriteExample;
use crate::db::vocabulary::VocabularyTerm;

const DEFAULT_SYSTEM_INSTRUCTION: &str = r#"You are the DictateAI rewrite engine. Rewrite raw speech transcriptions into clear written text.

CRITICAL RULES — follow these strictly:
1. Preserve the user's meaning and intent.
2. Remove filler words, repeated words, and obvious false starts.
3. Fix grammar, capitalization, and punctuation.
4. Keep the wording concise and natural.
5. Do NOT invent facts, details, or requests that were not spoken.
6. Keep names, product terms, and technical vocabulary accurate.
7. Use a neutral, natural tone.
8. Output ONLY the rewritten text. No explanations, no quotes, no markdown."#;

const BASE_SYSTEM_INSTRUCTION: &str = r#"You are the DictateAI rewrite engine. Rewrite raw speech transcriptions into clear written text.

CRITICAL RULES — follow these strictly:
1. Preserve the user's meaning and intent.
2. Remove filler words, repeated words, and obvious false starts.
3. Fix grammar, capitalization, and punctuation.
4. Keep the wording concise and natural.
5. Do NOT invent facts, details, or requests that were not spoken.
6. Keep names, product terms, and technical vocabulary accurate.
7. Output ONLY the rewritten text. No explanations, no quotes, no markdown."#;

pub fn default_system_instruction() -> &'static str {
    DEFAULT_SYSTEM_INSTRUCTION
}

pub fn system_instruction_for_tone(tone: &str) -> String {
    let normalized = normalize_tone(tone);
    if normalized == "neutral" {
        return DEFAULT_SYSTEM_INSTRUCTION.to_string();
    }

    format!(
        "{BASE_SYSTEM_INSTRUCTION}\n8. {}",
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
        _ => "Use a neutral, natural tone.",
    }
}
