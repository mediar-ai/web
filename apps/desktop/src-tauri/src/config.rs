//! Centralized configuration module for API endpoints
//! Single source of truth for all external API communication

use log::info;
use once_cell::sync::Lazy;
use std::sync::RwLock;

/// Global API base URL cache
static API_BASE_URL_CACHE: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));

/// Get the API base URL
///
/// Priority order:
/// 1. MEDIAR_API_URL environment variable (for development/testing)
/// 2. Default production URL
pub fn get_api_base_url() -> String {
    // Check cache first
    if let Ok(cache) = API_BASE_URL_CACHE.read() {
        if let Some(cached_url) = cache.as_ref() {
            return cached_url.clone();
        }
    }

    // Get from environment or use default
    let url = std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| {
        info!("MEDIAR_API_URL not set, using production URL");
        "https://app.mediar.ai".to_string()
    });

    // Cache the result
    if let Ok(mut cache) = API_BASE_URL_CACHE.write() {
        *cache = Some(url.clone());
        info!("API base URL configured: {}", url);
    }

    url
}

/// API endpoint builders
pub struct ApiEndpoints;

impl ApiEndpoints {
    /// Authentication endpoints
    pub fn auth_verify_token() -> String {
        format!("{}/api/auth/verify-desktop-token", get_api_base_url())
    }

    pub fn auth_desktop_session(session_id: &str) -> String {
        format!(
            "{}/api/auth/desktop-session/{}",
            get_api_base_url(),
            session_id
        )
    }

    /// Ingestion endpoints
    pub fn ingest_events() -> String {
        format!("{}/api/ingest", get_api_base_url())
    }

    pub fn ingest_mcp_workflow() -> String {
        format!("{}/api/ingest/mcp-workflow", get_api_base_url())
    }

    pub fn ingest_rpa_kb() -> String {
        format!("{}/api/rpa-kb", get_api_base_url())
    }

    pub fn support_logs() -> String {
        format!("{}/api/desktop/support-logs", get_api_base_url())
    }
}

/// Check if running in local development mode
pub fn is_local_development() -> bool {
    let url = get_api_base_url();
    url.contains("localhost") || url.contains("127.0.0.1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_api_url() {
        // When MEDIAR_API_URL is not set, should use production
        std::env::remove_var("MEDIAR_API_URL");
        let url = get_api_base_url();
        assert_eq!(url, "https://app.mediar.ai");
    }

    #[test]
    fn test_endpoint_builders() {
        std::env::remove_var("MEDIAR_API_URL");

        assert_eq!(
            ApiEndpoints::auth_verify_token(),
            "https://app.mediar.ai/api/auth/verify-desktop-token"
        );

        assert_eq!(
            ApiEndpoints::auth_desktop_session("test-session"),
            "https://app.mediar.ai/api/auth/desktop-session/test-session"
        );

        assert_eq!(
            ApiEndpoints::ingest_events(),
            "https://app.mediar.ai/api/ingest"
        );
    }
}
