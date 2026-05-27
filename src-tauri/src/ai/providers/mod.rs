use std::sync::Arc;

use super::AIProvider;

pub mod twelve_ai;

pub use twelve_ai::TwelveAiProvider;

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        Arc::new(TwelveAiProvider::new_gemini_image()),
        Arc::new(TwelveAiProvider::new_gpt_image()),
        Arc::new(TwelveAiProvider::new_text()),
        Arc::new(TwelveAiProvider::new_veo_video()),
    ]
}
