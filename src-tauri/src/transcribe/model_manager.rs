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
            name: "nova-3".into(),
            label: "Deepgram".into(),
            description: "Deepgram Nova-3 speech transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "chirp_3".into(),
            label: "Google".into(),
            description: "Google Chirp 3 speech transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "gpt-4o-transcribe".into(),
            label: "OpenAI".into(),
            description: "OpenAI GPT-4o Transcribe speech-to-text.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "gpt-4o-mini-transcribe".into(),
            label: "OpenAI".into(),
            description: "OpenAI GPT-4o Mini Transcribe speech-to-text.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "qwen3-asr-flash".into(),
            label: "Alibaba".into(),
            description: "Alibaba Qwen3 ASR Flash transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
    ]
}
