// API Configuration constants
// These are loaded from environment variables at runtime
use std::sync::LazyLock;

pub static GEMINI_API_KEY: LazyLock<String> = LazyLock::new(|| std::env::var("GEMINI_API_KEY").unwrap_or_default());
pub const GEMINI_MODEL: &str = "gemini-3-pro-preview";
pub const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

// Analytics constants
pub static POSTHOG_API_KEY: LazyLock<String> = LazyLock::new(|| {
    std::env::var("POSTHOG_API_KEY").unwrap_or_else(|_| "phc_NFSaZUao49XckpqaeyB3lIEKrFXhhXbKaI81jqZ8yn9".to_string())
});
pub const POSTHOG_ENDPOINT: &str = "https://eu.i.posthog.com/capture/";

// LLM Processing constants
pub const MAX_RETRIES: u32 = 3;
pub const BASE_DELAY_MS: u64 = 1000;
pub const MAX_DELAY_SECS: u64 = 30;
pub const RECENT_EVENTS_LIMIT: usize = 5;

// Event Queue Manager constants
pub const MAX_QUEUE_SIZE: usize = 50;
pub const MIN_BATCH_SIZE: usize = 12;
pub const BATCH_TIMEOUT_SECONDS: u64 = 15;
pub const HIGH_PRIORITY_IMMEDIATE_PROCESS: bool = true;

// Workflow Recorder constants
pub const FOCUS_DEBOUNCE_MS: u64 = 500; // Ignore duplicate focus events within 500ms
pub const PROPERTY_DEBOUNCE_MS: u64 = 200; // Ignore duplicate property events within 200ms
pub const MAX_RESTARTS: u32 = 10;

// App Context Manager constants
pub const MAX_STATES_PER_APP: usize = 2; // Only capture at most 2 times per app
pub const MAX_STATE_AGE_MINUTES: u64 = 30;
pub const MAX_TOTAL_STATES: usize = 25;
pub const MIN_CAPTURE_INTERVAL_SECONDS: u64 = 15;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_constants() {
        // Verify static API configuration constants are not empty
        // Note: GEMINI_API_KEY is loaded from env var at runtime, so we don't test it here
        assert!(!GEMINI_MODEL.is_empty(), "Gemini model should not be empty");
        assert!(
            !GEMINI_BASE_URL.is_empty(),
            "Gemini base URL should not be empty"
        );

        // Verify URLs are properly formatted
        assert!(
            GEMINI_BASE_URL.starts_with("https://"),
            "Gemini base URL should use HTTPS"
        );
        assert!(
            POSTHOG_ENDPOINT.starts_with("https://"),
            "PostHog endpoint should use HTTPS"
        );
    }

    #[test]
    fn test_analytics_constants() {
        // POSTHOG_API_KEY has a default fallback, so it should never be empty
        assert!(
            !POSTHOG_API_KEY.is_empty(),
            "PostHog API key should not be empty (has default)"
        );
        assert!(
            !POSTHOG_ENDPOINT.is_empty(),
            "PostHog endpoint should not be empty"
        );
        assert!(
            POSTHOG_ENDPOINT.ends_with("/"),
            "PostHog endpoint should end with slash"
        );
    }

    #[test]
    fn test_llm_processing_constants() {
        assert!(MAX_RETRIES > 0, "Max retries should be greater than 0");
        assert!(BASE_DELAY_MS > 0, "Base delay should be greater than 0");
        assert!(MAX_DELAY_SECS > 0, "Max delay should be greater than 0");
        assert!(
            RECENT_EVENTS_LIMIT > 0,
            "Recent events limit should be greater than 0"
        );

        // Verify reasonable bounds
        assert!(MAX_RETRIES <= 10, "Max retries should be reasonable (≤10)");
        assert!(
            MAX_DELAY_SECS <= 300,
            "Max delay should be reasonable (≤5 minutes)"
        );
    }

    #[test]
    fn test_queue_manager_constants() {
        assert!(
            MAX_QUEUE_SIZE > 0,
            "Max queue size should be greater than 0"
        );
        assert!(
            MIN_BATCH_SIZE > 0,
            "Min batch size should be greater than 0"
        );
        assert!(
            BATCH_TIMEOUT_SECONDS > 0,
            "Batch timeout should be greater than 0"
        );

        // Verify logical relationships
        assert!(
            MIN_BATCH_SIZE <= MAX_QUEUE_SIZE,
            "Min batch size should not exceed max queue size"
        );
        assert!(
            BATCH_TIMEOUT_SECONDS <= 300,
            "Batch timeout should be reasonable (≤5 minutes)"
        );
    }

    #[test]
    fn test_workflow_recorder_constants() {
        assert!(
            FOCUS_DEBOUNCE_MS > 0,
            "Focus debounce should be greater than 0"
        );
        assert!(
            PROPERTY_DEBOUNCE_MS > 0,
            "Property debounce should be greater than 0"
        );
        assert!(MAX_RESTARTS > 0, "Max restarts should be greater than 0");

        // Verify reasonable bounds
        assert!(
            FOCUS_DEBOUNCE_MS <= 5000,
            "Focus debounce should be reasonable (≤5s)"
        );
        assert!(
            PROPERTY_DEBOUNCE_MS <= 5000,
            "Property debounce should be reasonable (≤5s)"
        );
        assert!(
            MAX_RESTARTS <= 100,
            "Max restarts should be reasonable (≤100)"
        );
    }

    #[test]
    fn test_app_context_manager_constants() {
        assert!(
            MAX_STATES_PER_APP > 0,
            "Max states per app should be greater than 0"
        );
        assert!(
            MAX_STATE_AGE_MINUTES > 0,
            "Max state age should be greater than 0"
        );
        assert!(
            MAX_TOTAL_STATES > 0,
            "Max total states should be greater than 0"
        );
        assert!(
            MIN_CAPTURE_INTERVAL_SECONDS > 0,
            "Min capture interval should be greater than 0"
        );

        // Verify logical relationships
        assert!(
            MAX_STATES_PER_APP <= MAX_TOTAL_STATES,
            "Max states per app should not exceed total"
        );
        assert!(
            MAX_STATE_AGE_MINUTES <= 1440,
            "Max state age should be reasonable (≤24 hours)"
        );
        assert!(
            MIN_CAPTURE_INTERVAL_SECONDS <= 3600,
            "Min capture interval should be reasonable (≤1 hour)"
        );
    }
}
