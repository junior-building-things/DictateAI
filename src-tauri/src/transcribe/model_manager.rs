#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelInfo {
    pub name: String,
    pub label: String,
    pub description: String,
    pub filename: String,
    pub size_mb: u64,
}

pub fn available_models(_language: &str) -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            name: "gpt-4o-mini-transcribe".into(),
            label: "Mini".into(),
            description: "OpenAI model optimized for fast, low-cost transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "gpt-4o-transcribe".into(),
            label: "Plus".into(),
            description: "OpenAI model with stronger accuracy for difficult audio.".into(),
            filename: "".into(),
            size_mb: 0,
        },
    ]
}
