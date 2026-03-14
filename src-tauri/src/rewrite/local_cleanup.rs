#[derive(Debug, Clone, Copy)]
pub struct LocalCleanupOptions {
    pub filler: bool,
    pub repeats: bool,
    pub corrections: bool,
    pub preserve: bool,
    pub punctuation: bool,
}

pub fn rewrite(input: &str, options: LocalCleanupOptions) -> String {
    let mut text = input.trim().to_string();
    if text.is_empty() {
        return text;
    }

    if options.corrections {
        text = trim_false_starts(&text);
    }

    let mut tokens = tokenize(&text);
    if options.filler {
        tokens.retain(|token| !is_filler(token));
    }
    if options.repeats {
        tokens = collapse_repeats(tokens);
    }

    text = tokens.join(" ");
    text = normalize_spacing(&text);

    if !options.preserve {
        text = sentence_case(&text);
    }

    if options.punctuation {
        text = ensure_terminal_punctuation(&text);
    } else {
        text = text.trim_end_matches(['.', '!', '?']).trim().to_string();
    }

    text
}

fn tokenize(input: &str) -> Vec<String> {
    input
        .split_whitespace()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .collect()
}

fn is_filler(token: &str) -> bool {
    matches!(
        normalized_word(token).as_str(),
        "um" | "uh" | "erm" | "hmm" | "like"
    )
}

fn collapse_repeats(tokens: Vec<String>) -> Vec<String> {
    let mut collapsed: Vec<String> = Vec::new();

    for token in tokens {
        let normalized = normalized_word(&token);
        if collapsed
            .last()
            .map(|previous| normalized_word(previous) == normalized)
            .unwrap_or(false)
        {
            continue;
        }

        collapsed.push(token);
    }

    collapsed
}

fn trim_false_starts(input: &str) -> String {
    let lower = input.to_lowercase();
    for marker in [" i mean ", " sorry ", " actually ", " no wait ", " wait "] {
        if let Some(index) = lower.rfind(marker) {
            let candidate = input[index + marker.len()..].trim();
            if !candidate.is_empty() {
                return candidate.to_string();
            }
        }
    }

    input.to_string()
}

fn normalize_spacing(input: &str) -> String {
    input
        .replace(" ,", ",")
        .replace(" .", ".")
        .replace(" !", "!")
        .replace(" ?", "?")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn sentence_case(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut capitalized = false;

    for ch in input.chars() {
        if !capitalized && ch.is_alphabetic() {
            for upper in ch.to_uppercase() {
                result.push(upper);
            }
            capitalized = true;
        } else {
            result.push(ch);
        }
    }

    result
}

fn ensure_terminal_punctuation(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.ends_with(['.', '!', '?']) {
        trimmed.to_string()
    } else {
        format!("{trimmed}.")
    }
}

fn normalized_word(token: &str) -> String {
    token
        .chars()
        .filter(|ch| ch.is_alphanumeric() || *ch == '\'')
        .collect::<String>()
        .to_lowercase()
}
