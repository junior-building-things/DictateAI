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
            name: "deepgram-nova-3".into(),
            label: "Deepgram".into(),
            description: "Deepgram Nova-3 speech transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "google-chirp-3".into(),
            label: "Google".into(),
            description: "Google Chirp 3 speech transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "nvidia-parakeet-tdt-0.6b-v2".into(),
            label: "NVIDIA".into(),
            description: "NVIDIA-compatible Parakeet TDT 0.6B v2 transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "nvidia-canary-qwen-2.5b".into(),
            label: "NVIDIA".into(),
            description: "NVIDIA-compatible Canary Qwen 2.5B transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
        ModelInfo {
            name: "alibaba-qwen3-asr-flash".into(),
            label: "Alibaba".into(),
            description: "Alibaba Qwen3 ASR Flash transcription.".into(),
            filename: "".into(),
            size_mb: 0,
        },
    ]
}
