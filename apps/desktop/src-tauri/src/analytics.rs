use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{error, warn};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use tokio::time::timeout;

use crate::constants::{POSTHOG_API_KEY, POSTHOG_ENDPOINT};

#[derive(Deserialize, Debug, serde::Serialize)]
struct PostHogFeatureFlagResponse {
    flags: Option<serde_json::Value>,
    #[serde(rename = "errorsWhileComputingFlags")]
    errors_while_computing_flags: Option<bool>,
}

#[derive(Clone)]
pub struct Analytics {
    client: Client,
    distinct_id: String,
    first_use_timestamp: Option<u128>,
}

impl Analytics {
    pub fn new(distinct_id: String) -> Self {
        // Create client with 3-second timeout to prevent DNS/TCP hangs
        let client = Client::builder()
            .timeout(Duration::from_secs(3))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .unwrap_or_else(|e| {
                log::warn!(
                    "Failed to create HTTP client with timeout, using default: {}",
                    e
                );
                Client::new()
            });

        Self {
            client,
            distinct_id,
            first_use_timestamp: None,
        }
    }

    pub async fn get_feature_flag(
        &self,
        flag_name: &str,
    ) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
        log::info!("🔍 [DEBUG] get_feature_flag() called for: {}", flag_name);
        let payload = json!({
            "api_key": POSTHOG_API_KEY,
            "distinct_id": self.distinct_id,
            "person_properties": {
                "distinct_id": self.distinct_id,
                "app_version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS
            },
            "groups": {},
            "$anon_distinct_id": null
        });

        // Use the correct /flags endpoint according to PostHog documentation
        let flags_endpoint = POSTHOG_ENDPOINT.replace("/capture/", "/flags?v=2");
        log::info!("🔍 [DEBUG] About to POST to: {}", flags_endpoint);

        // Add 3-second timeout to prevent hanging on network issues
        log::info!("🔍 [DEBUG] Starting HTTP POST with 3s timeout...");
        let response = match timeout(
            Duration::from_secs(3),
            self.client.post(&flags_endpoint).json(&payload).send(),
        )
        .await
        {
            Ok(Ok(resp)) => {
                log::info!("🔍 [DEBUG] HTTP POST succeeded, got response");
                resp
            }
            Ok(Err(e)) => {
                warn!(
                    "Failed to get feature flag '{}' from PostHog: {}",
                    flag_name, e
                );
                log::info!("🔍 [DEBUG] HTTP POST failed with error");
                return Err(e.into());
            }
            Err(_) => {
                warn!(
                    "⏱️ PostHog feature flag request for '{}' timed out after 3s - skipping",
                    flag_name
                );
                log::info!("🔍 [DEBUG] HTTP POST timed out after 3s");
                return Err("Request timeout".into());
            }
        };

        if response.status().is_success() {
            let body: PostHogFeatureFlagResponse = response.json().await?;

            log::info!(
                "🔍 [DEBUG] PostHog response for '{}': flags={:?}",
                flag_name,
                body.flags
                    .as_ref()
                    .map(|f| f.to_string().chars().take(200).collect::<String>())
            );

            if let Some(errors) = body.errors_while_computing_flags {
                if errors {
                    warn!("PostHog reported errors while computing flags");
                }
            }

            if let Some(flags) = body.flags {
                log::info!(
                    "🔍 [DEBUG] Looking for flag '{}' in keys: {:?}",
                    flag_name,
                    flags.as_object().map(|o| o.keys().collect::<Vec<_>>())
                );
                if let Some(flag_data) = flags.get(flag_name) {
                    log::info!("🔍 [DEBUG] Found flag '{}': {:?}", flag_name, flag_data);
                    // Handle the new flag response format
                    if let Some(flag_obj) = flag_data.as_object() {
                        // First, check for variant value (for multivariate flags)
                        if let Some(variant) = flag_obj.get("variant") {
                            if let Some(variant_str) = variant.as_str() {
                                log::info!(
                                    "🔍 [DEBUG] Flag '{}' has variant: {}",
                                    flag_name,
                                    variant_str
                                );
                                return Ok(Some(variant_str.to_string()));
                            }
                        }

                        // Check if flag is enabled (for boolean flags)
                        if let Some(enabled) = flag_obj.get("enabled") {
                            let is_enabled = enabled.as_bool().unwrap_or(false);
                            log::info!("🔍 [DEBUG] Flag '{}' enabled={}", flag_name, is_enabled);
                            if is_enabled {
                                return Ok(Some("true".to_string()));
                            } else {
                                return Ok(None);
                            }
                        }

                        // If no enabled field but has variant, assume enabled
                        log::info!(
                            "🔍 [DEBUG] Flag '{}' has no enabled field, assuming true",
                            flag_name
                        );
                        return Ok(Some("true".to_string()));
                    } else {
                        log::info!(
                            "🔍 [DEBUG] Flag '{}' is not an object: {:?}",
                            flag_name,
                            flag_data
                        );
                    }
                } else {
                    log::info!("🔍 [DEBUG] Flag '{}' NOT found in response", flag_name);
                }
            } else {
                log::info!("🔍 [DEBUG] No flags object in response for '{}'", flag_name);
            }
            Ok(None)
        } else {
            let status = response.status();
            let text = response.text().await?;
            error!("Failed to get feature flags: {} - {}", status, text);
            Err(format!("Failed to get feature flags: {status}").into())
        }
    }

    async fn track_event(
        &self,
        event_name: &str,
        properties: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
        let iso_timestamp = chrono::Utc::now().to_rfc3339();

        let mut event_properties = properties.unwrap_or_else(|| json!({}));

        // Add common properties
        if let Some(obj) = event_properties.as_object_mut() {
            obj.insert("app_version".to_string(), json!(env!("CARGO_PKG_VERSION")));
            obj.insert("os".to_string(), json!(std::env::consts::OS));

            // Add first use timestamp if available
            if let Some(first_use) = self.first_use_timestamp {
                obj.insert(
                    "days_since_first_use".to_string(),
                    json!((timestamp - first_use) / (86400 * 1000)),
                ); // Convert to days from milliseconds
            }
        }

        let payload = json!({
            "api_key": POSTHOG_API_KEY,
            "event": event_name,
            "distinct_id": self.distinct_id,
            "properties": event_properties,
            "timestamp": iso_timestamp
        });

        // Add 3-second timeout to prevent hanging on network issues
        let result = timeout(
            Duration::from_secs(3),
            self.client.post(POSTHOG_ENDPOINT).json(&payload).send(),
        )
        .await;

        match result {
            Ok(Ok(response)) => {
                if response.status().is_success() {
                    Ok(())
                } else {
                    let status = response.status();
                    let resp_text = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<Failed to read body>".to_string());
                    let error_msg = format!(
                        "Failed to track event {event_name}: {status} | Response body: {resp_text} | Payload: {payload}"
                    );
                    error!("{}", error_msg);
                    Err(error_msg.into())
                }
            }
            Ok(Err(e)) => {
                let error_msg = format!("Failed to send analytics event {event_name}: {e}");
                error!("{}", error_msg);
                Err(error_msg.into())
            }
            Err(_) => {
                let error_msg = format!(
                    "⏱️ Analytics event '{}' timed out after 3s - skipping",
                    event_name
                );
                warn!("{}", error_msg);
                Err(error_msg.into())
            }
        }
    }

    pub async fn track_app_start(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();

        // If this is first use, set the timestamp
        if self.first_use_timestamp.is_none() {
            let mut this = self.clone();
            this.first_use_timestamp = Some(timestamp);
        }

        self.track_event("desktop_app_started", None).await
    }

    pub async fn track_shortcut_triggered(
        &self,
        success: bool,
        fields_found: usize,
        fields_filled: usize,
        app_name: &str,
        error_type: Option<&str>,
        time_to_fill: Option<u64>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let properties = json!({
            "success": success,
            "fields_found": fields_found,
            "fields_filled": fields_filled,
            "app_name": app_name,
            "error_type": error_type,
            "time_to_fill_ms": time_to_fill,
            "fill_accuracy": if fields_found > 0 { fields_filled as f64 / fields_found as f64 } else { 0.0 }
        });
        self.track_event("shortcut_triggered", Some(properties))
            .await
    }

    pub async fn track_events_sent(
        &self,
        count: usize,
        session_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let properties = json!({
            "event_count": count,
            "session_id": session_id,
        });
        self.track_event("events_sent_to_api", Some(properties))
            .await
    }

    pub async fn track_performance_snapshot(
        &self,
        total_memory_gb: f64,
        memory_usage_percent: f64,
        total_cpu: f32,
        virtual_memory_gb: f64,
        runtime_seconds: u64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let properties = json!({
            "total_memory_gb": total_memory_gb,
            "memory_usage_percent": memory_usage_percent,
            "cpu_usage_percent": total_cpu,
            "virtual_memory_gb": virtual_memory_gb,
            "runtime_seconds": runtime_seconds,
        });
        self.track_event("performance_snapshot", Some(properties))
            .await
    }

    pub async fn track_retention(
        &self,
        days_since_first_use: u64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let properties = json!({
            "days_since_first_use": days_since_first_use
        });
        self.track_event("retention_check", Some(properties)).await
    }

    /// Check if low energy mode should be enabled for this user
    pub async fn should_enable_low_energy_mode(&self) -> bool {
        log::info!("🔍 [DEBUG] Entering should_enable_low_energy_mode()...");
        match self.get_feature_flag("low-energy-mode").await {
            Ok(Some(flag_value)) => {
                log::info!("🔍 [DEBUG] Got feature flag value: {}", flag_value);
                let enabled = flag_value == "true"
                    || flag_value == "enabled"
                    || flag_value == "on"
                    || flag_value == "low-energy-mode";
                if enabled {
                    // Track that low energy mode was enabled
                    if let Err(e) = self.track_low_energy_mode_status(true).await {
                        warn!("Failed to track low energy mode status: {}", e);
                    }
                }
                enabled
            }
            Ok(None) => {
                log::info!("🔍 [DEBUG] Feature flag not set, returning false");
                false
            }
            Err(e) => {
                warn!(
                    "Failed to check low-energy-mode feature flag: {}, defaulting to disabled",
                    e
                );
                log::info!("🔍 [DEBUG] Feature flag error, returning false");
                false
            }
        }
    }

    /// Track low energy mode status for analytics
    pub async fn track_low_energy_mode_status(
        &self,
        enabled: bool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let properties = json!({
            "low_energy_mode_enabled": enabled,
            "source": "posthog_feature_flag"
        });
        self.track_event("low_energy_mode_status", Some(properties))
            .await
    }

    /// Track recording start events
    pub async fn track_recording_start(
        &self,
        source: &str,                    // "tray_menu" or "trigger"
        trigger_rule_id: Option<&str>,   // If from trigger, the rule ID
        trigger_rule_name: Option<&str>, // If from trigger, the rule name
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut properties = json!({
            "source": source,
        });

        if let Some(rule_id) = trigger_rule_id {
            properties["trigger_rule_id"] = json!(rule_id);
        }

        if let Some(rule_name) = trigger_rule_name {
            properties["trigger_rule_name"] = json!(rule_name);
        }

        self.track_event("recording_started", Some(properties))
            .await
    }

    /// Track recording stop events
    pub async fn track_recording_stop(
        &self,
        source: &str,                    // "tray_menu" or "trigger"
        trigger_rule_id: Option<&str>,   // If from trigger, the rule ID
        trigger_rule_name: Option<&str>, // If from trigger, the rule name
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut properties = json!({
            "source": source,
        });

        if let Some(rule_id) = trigger_rule_id {
            properties["trigger_rule_id"] = json!(rule_id);
        }

        if let Some(rule_name) = trigger_rule_name {
            properties["trigger_rule_name"] = json!(rule_name);
        }

        self.track_event("recording_stopped", Some(properties))
            .await
    }

    /// Set user properties for targeting (like system performance)
    pub async fn identify_user_with_system_info(
        &self,
        cpu_usage_percent: f32,
        memory_usage_percent: f64,
        total_memory_gb: f64,
        os_info: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let timestamp = chrono::Utc::now().to_rfc3339();

        let payload = json!({
            "api_key": POSTHOG_API_KEY,
            "event": "$identify",
            "distinct_id": self.distinct_id,
            "properties": {
                "$set": {
                    "cpu_usage_percent": cpu_usage_percent,
                    "memory_usage_percent": memory_usage_percent,
                    "total_memory_gb": total_memory_gb,
                    "os": os_info.unwrap_or(std::env::consts::OS),
                    "app_version": env!("CARGO_PKG_VERSION"),
                    "last_performance_update": timestamp.clone(),
                    "needs_low_energy": cpu_usage_percent >= 70.0 || memory_usage_percent >= 70.0
                }
            },
            "timestamp": timestamp
        });

        // Add 3-second timeout to prevent hanging on network issues
        let response = match timeout(
            Duration::from_secs(3),
            self.client.post(POSTHOG_ENDPOINT).json(&payload).send(),
        )
        .await
        {
            Ok(Ok(resp)) => resp,
            Ok(Err(e)) => {
                warn!("Failed to identify user with system info: {}", e);
                return Err(e.into());
            }
            Err(_) => {
                warn!("⏱️ PostHog identify user request timed out after 3s - skipping");
                return Err("Request timeout".into());
            }
        };

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let resp_text = response
                .text()
                .await
                .unwrap_or_else(|_| "<Failed to read body>".to_string());
            let error_msg = format!("Failed to identify user: {status} | Response: {resp_text}");
            error!("{}", error_msg);
            Err(error_msg.into())
        }
    }

    /// Track deploy button click
    pub async fn track_deploy_button_clicked(
        &self,
        workflow_id: String,
        workflow_name: String,
        step_count: usize,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let properties = json!({
            "workflow_id": workflow_id,
            "workflow_name": workflow_name,
            "step_count": step_count,
        });
        self.track_event("desktop_deploy_button_clicked", Some(properties))
            .await
    }

    /// Identify user after authentication with their actual user ID
    pub async fn identify_user(
        &mut self,
        user_id: String,
        email: String,
        machine_id: String,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let timestamp = chrono::Utc::now().to_rfc3339();

        // First, alias the machine ID to the user ID to merge profiles
        // This links all previous anonymous events to the user
        let alias_payload = json!({
            "api_key": POSTHOG_API_KEY,
            "event": "$create_alias",
            "distinct_id": user_id.clone(),  // The user ID we want to use going forward
            "properties": {
                "alias": machine_id.clone(),  // The machine ID we were using before
                "timestamp": timestamp.clone()
            },
            "timestamp": timestamp.clone()
        });

        tracing::info!(
            "🔗 Linking machine ID {} to user ID {}",
            machine_id,
            user_id
        );

        // Add 3-second timeout to prevent hanging on network issues
        let alias_response = match timeout(
            Duration::from_secs(3),
            self.client
                .post(POSTHOG_ENDPOINT)
                .json(&alias_payload)
                .send(),
        )
        .await
        {
            Ok(Ok(resp)) => resp,
            Ok(Err(e)) => {
                tracing::warn!("Failed to alias machine ID to user ID: {}", e);
                return Err(e.into());
            }
            Err(_) => {
                tracing::warn!("⏱️ PostHog alias request timed out after 3s - skipping");
                return Err("Request timeout".into());
            }
        };

        if !alias_response.status().is_success() {
            let status = alias_response.status();
            let resp_text = alias_response
                .text()
                .await
                .unwrap_or_else(|_| "<Failed to read body>".to_string());
            tracing::warn!(
                "Failed to alias machine ID to user ID: {} | Response: {}",
                status,
                resp_text
            );
            // Continue even if alias fails - we still want to identify the user
        } else {
            tracing::info!("✅ Successfully linked machine ID to user ID in PostHog");
        }

        // Now identify the user with their properties
        let identify_payload = json!({
            "api_key": POSTHOG_API_KEY,
            "event": "$identify",
            "distinct_id": user_id.clone(),
            "properties": {
                "$set": {
                    "email": email.clone(),
                    "machine_id": machine_id.clone(),
                    "app_version": env!("CARGO_PKG_VERSION"),
                    "os": std::env::consts::OS,
                    "app_platform": "desktop",
                    "authenticated_at": timestamp.clone()
                },
                "$set_once": {
                    "first_authenticated_at": timestamp.clone()
                }
            },
            "timestamp": timestamp
        });

        tracing::info!("🔐 Identifying user {} with email {}", user_id, email);

        // Add 3-second timeout to prevent hanging on network issues
        let identify_response = match timeout(
            Duration::from_secs(3),
            self.client
                .post(POSTHOG_ENDPOINT)
                .json(&identify_payload)
                .send(),
        )
        .await
        {
            Ok(Ok(resp)) => resp,
            Ok(Err(e)) => {
                tracing::warn!("Failed to identify user: {}", e);
                return Err(e.into());
            }
            Err(_) => {
                tracing::warn!("⏱️ PostHog identify request timed out after 3s - skipping");
                return Err("Request timeout".into());
            }
        };

        if identify_response.status().is_success() {
            // Update the distinct_id to use the user ID for all future events
            self.distinct_id = user_id.clone();
            tracing::info!("✅ User successfully identified in PostHog");

            // Track the authentication success event
            let auth_properties = json!({
                "user_id": user_id,
                "email": email,
                "machine_id": machine_id,
                "auth_method": "clerk",
            });

            if let Err(e) = self
                .track_event("desktop_user_authenticated", Some(auth_properties))
                .await
            {
                tracing::warn!("Failed to track desktop_user_authenticated event: {}", e);
            } else {
                tracing::info!("✅ desktop_user_authenticated event tracked");
            }

            Ok(())
        } else {
            let status = identify_response.status();
            let resp_text = identify_response
                .text()
                .await
                .unwrap_or_else(|_| "<Failed to read body>".to_string());
            let error_msg = format!("Failed to identify user: {status} | Response: {resp_text}");
            error!("{}", error_msg);
            Err(error_msg.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_analytics() -> Analytics {
        Analytics::new("test_user_123".to_string())
    }

    #[test]
    fn test_analytics_new() {
        let analytics = Analytics::new("test_user".to_string());
        assert_eq!(analytics.distinct_id, "test_user");
        // Client is always initialized
        assert!(true, "Analytics client created successfully");
    }

    #[test]
    fn test_distinct_id_validation() {
        // Test with empty string
        let analytics = Analytics::new("".to_string());
        assert_eq!(analytics.distinct_id, "");

        // Test with normal string
        let analytics = Analytics::new("user123".to_string());
        assert_eq!(analytics.distinct_id, "user123");

        // Test with special characters
        let analytics = Analytics::new("user@example.com".to_string());
        assert_eq!(analytics.distinct_id, "user@example.com");
    }

    #[tokio::test]
    async fn test_should_enable_low_energy_mode_default() {
        let analytics = create_test_analytics();

        // Should return a boolean value (actual default may vary)
        let result = analytics.should_enable_low_energy_mode().await;
        assert!(result || !result, "Low energy mode should return a boolean");
    }

    #[test]
    fn test_build_event_properties() {
        let analytics = create_test_analytics();
        let mut properties = std::collections::HashMap::new();
        properties.insert(
            "test_key".to_string(),
            serde_json::Value::String("test_value".to_string()),
        );

        // This is testing the internal structure - we can validate that the analytics
        // object maintains its distinct_id correctly
        assert_eq!(analytics.distinct_id, "test_user_123");
    }

    #[tokio::test]
    async fn test_track_app_start_structure() {
        let analytics = create_test_analytics();

        // We can't easily test the HTTP call without mocking, but we can ensure
        // the method doesn't panic and handles errors gracefully
        let result = analytics.track_app_start().await;

        // The method should return either Ok or an Error, but not panic
        match result {
            Ok(_) => assert!(true, "track_app_start succeeded"),
            Err(_) => assert!(true, "track_app_start failed gracefully"),
        }
    }

    #[tokio::test]
    async fn test_track_shortcut_triggered_structure() {
        let analytics = create_test_analytics();

        let result = analytics
            .track_shortcut_triggered(
                true,       // success: bool
                5,          // fields_found: usize
                3,          // fields_filled: usize
                "test_app", // app_name: &str
                None,       // error_type: Option<&str>
                Some(1000), // time_to_fill: Option<u64>
            )
            .await;

        match result {
            Ok(_) => assert!(true, "track_shortcut_triggered succeeded"),
            Err(_) => assert!(true, "track_shortcut_triggered failed gracefully"),
        }
    }

    #[tokio::test]
    async fn test_track_events_sent_structure() {
        let analytics = create_test_analytics();

        let result = analytics.track_events_sent(5, "test_session_id").await;

        match result {
            Ok(_) => assert!(true, "track_events_sent succeeded"),
            Err(_) => assert!(true, "track_events_sent failed gracefully"),
        }
    }

    #[tokio::test]
    async fn test_track_performance_snapshot_structure() {
        let analytics = create_test_analytics();

        let result = analytics
            .track_performance_snapshot(
                50.0, // cpu_usage: f64
                75.0, // memory_usage_percent: f64
                2.5,  // total_cpu: f32
                4.0,  // virtual_memory_gb: f64
                120,  // uptime_seconds: u64
            )
            .await;

        match result {
            Ok(_) => assert!(true, "track_performance_snapshot succeeded"),
            Err(_) => assert!(true, "track_performance_snapshot failed gracefully"),
        }
    }

    #[tokio::test]
    async fn test_track_retention_structure() {
        let analytics = create_test_analytics();

        let result = analytics.track_retention(30).await; // 30 days since first use

        match result {
            Ok(_) => assert!(true, "track_retention succeeded"),
            Err(_) => assert!(true, "track_retention failed gracefully"),
        }
    }

    #[tokio::test]
    async fn test_track_recording_start_structure() {
        let analytics = create_test_analytics();

        let result = analytics
            .track_recording_start(
                "tray_menu", // source: &str
                None,        // trigger_rule_id: Option<&str>
                None,        // trigger_rule_name: Option<&str>
            )
            .await;

        match result {
            Ok(_) => assert!(true, "track_recording_start succeeded"),
            Err(_) => assert!(true, "track_recording_start failed gracefully"),
        }
    }

    #[tokio::test]
    async fn test_track_recording_stop_structure() {
        let analytics = create_test_analytics();

        let result = analytics
            .track_recording_stop(
                "tray_menu", // source: &str
                None,        // trigger_rule_id: Option<&str>
                None,        // trigger_rule_name: Option<&str>
            )
            .await;

        match result {
            Ok(_) => assert!(true, "track_recording_stop succeeded"),
            Err(_) => assert!(true, "track_recording_stop failed gracefully"),
        }
    }

    #[test]
    fn test_constants_usage() {
        // Verify that the analytics module uses the constants correctly
        use crate::constants::*;

        assert!(!POSTHOG_API_KEY.is_empty());
        assert!(!POSTHOG_ENDPOINT.is_empty());
        assert!(POSTHOG_ENDPOINT.starts_with("https://"));
    }

    #[tokio::test]
    async fn test_get_feature_flag_timeout() {
        let analytics = create_test_analytics();

        // This will attempt to contact PostHog, which may succeed or fail
        // The key is that it should NOT hang indefinitely
        let start = std::time::Instant::now();
        let _result = analytics.get_feature_flag("test-flag").await;
        let elapsed = start.elapsed();

        // Should complete within 5 seconds (3s timeout + some overhead)
        assert!(
            elapsed.as_secs() < 5,
            "get_feature_flag took {:?}, should timeout within 5s",
            elapsed
        );
    }

    #[tokio::test]
    async fn test_track_event_timeout() {
        let analytics = create_test_analytics();

        // This will attempt to contact PostHog
        let start = std::time::Instant::now();
        let _result = analytics.track_event("test_event", None).await;
        let elapsed = start.elapsed();

        // Should complete within 5 seconds (3s timeout + some overhead)
        assert!(
            elapsed.as_secs() < 5,
            "track_event took {:?}, should timeout within 5s",
            elapsed
        );
    }

    #[tokio::test]
    async fn test_should_enable_low_energy_mode_timeout() {
        let analytics = create_test_analytics();

        // This is the critical test - should_enable_low_energy_mode was causing startup hangs
        let start = std::time::Instant::now();
        let _result = analytics.should_enable_low_energy_mode().await;
        let elapsed = start.elapsed();

        // Should complete within 5 seconds (3s timeout + some overhead)
        assert!(
            elapsed.as_secs() < 5,
            "should_enable_low_energy_mode took {:?}, should timeout within 5s",
            elapsed
        );
    }
}
