use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::analytics::Analytics;

// Global remote features manager
static REMOTE_FEATURES: Lazy<Arc<RwLock<Option<RemoteFeatureManager>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFeatureFlags {
    // Core features
    pub workflow_recording_enabled: bool,
    pub chat_ui_enabled: bool,
    pub tray_only_mode: bool,

    // Additional features
    pub analytics_enabled: bool,
    pub form_filling_enabled: bool,
    pub remote_dashboard_enabled: bool,
    pub low_energy_mode: bool,

    // Advanced features
    pub auto_screenshot_enabled: bool,
    pub smart_triggers_enabled: bool,
    pub background_processing: bool,
}

impl Default for RemoteFeatureFlags {
    fn default() -> Self {
        Self {
            // Conservative defaults - enable core features
            workflow_recording_enabled: true,
            chat_ui_enabled: true,
            tray_only_mode: false,

            analytics_enabled: true,
            form_filling_enabled: true,
            remote_dashboard_enabled: false,
            low_energy_mode: false,

            auto_screenshot_enabled: true,
            smart_triggers_enabled: true,
            background_processing: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CachedFeature {
    pub value: bool,
    pub last_updated: Instant,
    pub cache_duration: Duration,
}

impl CachedFeature {
    pub fn new(value: bool, cache_duration: Duration) -> Self {
        Self {
            value,
            last_updated: Instant::now(),
            cache_duration,
        }
    }

    pub fn is_expired(&self) -> bool {
        self.last_updated.elapsed() >= self.cache_duration
    }
}

pub struct RemoteFeatureManager {
    analytics: Analytics,
    cached_flags: HashMap<String, CachedFeature>,
    last_full_refresh: Option<Instant>,
    refresh_interval: Duration,
}

impl RemoteFeatureManager {
    pub fn new(analytics: Analytics) -> Self {
        Self {
            analytics,
            cached_flags: HashMap::new(),
            last_full_refresh: None,
            refresh_interval: Duration::from_secs(300), // 5 minutes
        }
    }

    /// Get a feature flag value with caching
    pub async fn get_feature_flag(&mut self, flag_name: &str) -> bool {
        // Check cache first
        if let Some(cached) = self.cached_flags.get(flag_name) {
            if !cached.is_expired() {
                debug!(
                    "Using cached feature flag '{}': {}",
                    flag_name, cached.value
                );
                return cached.value;
            }
        }

        // Fetch from PostHog
        match self.analytics.get_feature_flag(flag_name).await {
            Ok(Some(flag_value)) => {
                let enabled = self.parse_flag_value(&flag_value);

                // Cache the result
                self.cached_flags.insert(
                    flag_name.to_string(),
                    CachedFeature::new(enabled, Duration::from_secs(180)), // 3 minutes cache
                );

                debug!(
                    "Fetched feature flag '{}': {} (raw: {})",
                    flag_name, enabled, flag_value
                );
                enabled
            }
            Ok(None) => {
                debug!("Feature flag '{}' not found, using default", flag_name);
                self.get_default_value(flag_name)
            }
            Err(e) => {
                warn!(
                    "Failed to fetch feature flag '{}': {}, using default",
                    flag_name, e
                );
                self.get_default_value(flag_name)
            }
        }
    }

    /// Fetch all feature flags and return structured object
    /// Returns defaults immediately on first call, fetches in background
    pub async fn get_all_feature_flags(&mut self) -> RemoteFeatureFlags {
        let is_first_call = self.last_full_refresh.is_none();
        let should_refresh = self
            .last_full_refresh
            .map(|last| last.elapsed() >= self.refresh_interval)
            .unwrap_or(true);

        if should_refresh {
            if is_first_call {
                // First call: return defaults immediately, fetch in background
                info!("First call - returning defaults immediately, fetching PostHog flags in background");

                // Clone analytics for background task
                let analytics = self.analytics.clone();

                // Spawn background fetch
                tokio::spawn(async move {
                    fetch_flags_in_background(analytics).await;
                });

                // Mark as refreshed to prevent multiple background fetches
                self.last_full_refresh = Some(Instant::now());

                // Return defaults immediately
                return RemoteFeatureFlags::default();
            }

            // Subsequent calls with stale cache: fetch in background, return cached
            info!("Refreshing PostHog flags in background");
            let analytics = self.analytics.clone();
            tokio::spawn(async move {
                fetch_flags_in_background(analytics).await;
            });
            self.last_full_refresh = Some(Instant::now());
        }

        // Return from cache (or defaults if cache is empty)
        RemoteFeatureFlags {
            workflow_recording_enabled: self.get_cached_or_default("workflow-recording-enabled"),
            chat_ui_enabled: self.get_cached_or_default("chat-ui-enabled"),
            tray_only_mode: self.get_cached_or_default("tray-only-mode"),
            analytics_enabled: self.get_cached_or_default("analytics-enabled"),
            form_filling_enabled: self.get_cached_or_default("form-filling-enabled"),
            remote_dashboard_enabled: self.get_cached_or_default("remote-dashboard-enabled"),
            low_energy_mode: self.get_cached_or_default("low-energy-mode"),
            auto_screenshot_enabled: self.get_cached_or_default("auto-screenshot-enabled"),
            smart_triggers_enabled: self.get_cached_or_default("smart-triggers-enabled"),
            background_processing: self.get_cached_or_default("background-processing"),
        }
    }

    /// Get cached value or default
    fn get_cached_or_default(&self, flag_name: &str) -> bool {
        self.cached_flags
            .get(flag_name)
            .map(|c| c.value)
            .unwrap_or_else(|| self.get_default_value(flag_name))
    }

    /// Parse various flag value formats
    fn parse_flag_value(&self, value: &str) -> bool {
        match value.to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" | "enabled" => true,
            "false" | "0" | "no" | "off" | "disabled" => false,
            _ => {
                // For multivariate flags, treat any non-false value as true
                debug!("Unknown flag value '{}', treating as enabled", value);
                true
            }
        }
    }

    /// Get sensible default values for features
    fn get_default_value(&self, flag_name: &str) -> bool {
        match flag_name {
            "workflow-recording-enabled" => true, // Core feature
            "chat-ui-enabled" => true,            // Core feature
            "tray-only-mode" => false,            // Default to full UI
            "analytics-enabled" => true,          // Helpful for debugging
            "form-filling-enabled" => true,       // Core feature
            "remote-dashboard-enabled" => false,  // Advanced feature
            "low-energy-mode" => false,           // Performance optimization
            "auto-screenshot-enabled" => true,    // Core feature
            "smart-triggers-enabled" => true,     // Core feature
            "background-processing" => true,      // Core feature
            _ => {
                warn!("Unknown feature flag '{}', defaulting to false", flag_name);
                false
            }
        }
    }

    /// Clear cache (useful for testing or forced refresh)
    pub fn clear_cache(&mut self) {
        self.cached_flags.clear();
        self.last_full_refresh = None;
        info!("Remote feature flag cache cleared");
    }
}

/// Initialize the global remote features manager
pub async fn init_remote_features(analytics: Analytics) -> Result<(), String> {
    let mut manager_lock = REMOTE_FEATURES.write().await;
    if manager_lock.is_some() {
        warn!("Remote features manager already initialized");
        return Ok(());
    }

    let manager = RemoteFeatureManager::new(analytics);
    *manager_lock = Some(manager);
    info!("✅ Remote features manager initialized");
    Ok(())
}

/// Get all feature flags (public API)
pub async fn get_remote_feature_flags() -> RemoteFeatureFlags {
    let mut manager_lock = REMOTE_FEATURES.write().await;
    match &mut *manager_lock {
        Some(manager) => manager.get_all_feature_flags().await,
        None => {
            warn!("Remote features manager not initialized, using defaults");
            RemoteFeatureFlags::default()
        }
    }
}

/// Get a specific feature flag (public API)
pub async fn get_remote_feature_flag(flag_name: &str) -> bool {
    let mut manager_lock = REMOTE_FEATURES.write().await;
    match &mut *manager_lock {
        Some(manager) => manager.get_feature_flag(flag_name).await,
        None => {
            warn!(
                "Remote features manager not initialized for flag '{}', using default",
                flag_name
            );
            matches!(
                flag_name,
                "workflow-recording-enabled" | "chat-ui-enabled" | "analytics-enabled"
            )
        }
    }
}

/// Clear feature flag cache (useful for testing)
pub async fn clear_remote_feature_cache() {
    let mut manager_lock = REMOTE_FEATURES.write().await;
    if let Some(manager) = &mut *manager_lock {
        manager.clear_cache();
    }
}

/// Fetch flags in background and update cache
async fn fetch_flags_in_background(analytics: Analytics) {
    let flag_names = [
        "workflow-recording-enabled",
        "chat-ui-enabled",
        "tray-only-mode",
        "analytics-enabled",
        "form-filling-enabled",
        "remote-dashboard-enabled",
        "low-energy-mode",
        "auto-screenshot-enabled",
        "smart-triggers-enabled",
        "background-processing",
    ];

    info!(
        "Background fetch: fetching {} flags from PostHog in parallel",
        flag_names.len()
    );

    // Fetch all flags in parallel
    let results = tokio::join!(
        analytics.get_feature_flag(flag_names[0]),
        analytics.get_feature_flag(flag_names[1]),
        analytics.get_feature_flag(flag_names[2]),
        analytics.get_feature_flag(flag_names[3]),
        analytics.get_feature_flag(flag_names[4]),
        analytics.get_feature_flag(flag_names[5]),
        analytics.get_feature_flag(flag_names[6]),
        analytics.get_feature_flag(flag_names[7]),
        analytics.get_feature_flag(flag_names[8]),
        analytics.get_feature_flag(flag_names[9]),
    );

    // Update cache with results
    let mut manager_lock = REMOTE_FEATURES.write().await;
    if let Some(manager) = &mut *manager_lock {
        let result_array = [
            results.0, results.1, results.2, results.3, results.4, results.5, results.6, results.7, results.8,
            results.9,
        ];

        let mut success_count = 0;
        for (i, result) in result_array.into_iter().enumerate() {
            let enabled = match result {
                Ok(Some(flag_value)) => {
                    success_count += 1;
                    manager.parse_flag_value(&flag_value)
                }
                Ok(None) => manager.get_default_value(flag_names[i]),
                Err(_) => manager.get_default_value(flag_names[i]),
            };

            manager.cached_flags.insert(
                flag_names[i].to_string(),
                CachedFeature::new(enabled, Duration::from_secs(180)),
            );
        }

        info!(
            "Background fetch complete: {}/{} flags fetched successfully",
            success_count,
            flag_names.len()
        );
    } else {
        warn!("Background fetch: manager not initialized, cannot update cache");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_flag_value() {
        let analytics = Analytics::new("test".to_string());
        let manager = RemoteFeatureManager::new(analytics);

        assert!(manager.parse_flag_value("true"));
        assert!(!manager.parse_flag_value("false"));
        assert!(manager.parse_flag_value("enabled"));
        assert!(!manager.parse_flag_value("disabled"));
        assert!(manager.parse_flag_value("1"));
        assert!(!manager.parse_flag_value("0"));
    }

    #[test]
    fn test_default_values() {
        let analytics = Analytics::new("test".to_string());
        let manager = RemoteFeatureManager::new(analytics);

        assert!(manager.get_default_value("workflow-recording-enabled"));
        assert!(!manager.get_default_value("tray-only-mode"));
        assert!(!manager.get_default_value("unknown-flag"));
    }
}
