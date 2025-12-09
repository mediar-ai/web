use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use tracing::{error, info, warn};

use crate::models::ExecutionStatus;

/// Client for calling the monitor API endpoint with authentication
#[derive(Clone)]
pub struct MonitorClient {
    app_url: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl MonitorClient {
    /// Create a new MonitorClient from environment variables
    pub fn new() -> Self {
        let app_url =
            std::env::var("APP_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string());
        let api_key = std::env::var("MEDIAR_SERVICE_API_KEY").ok();

        if api_key.is_none() {
            warn!("MEDIAR_SERVICE_API_KEY not set - monitor API calls will fail");
        }

        Self {
            app_url,
            api_key,
            client: reqwest::Client::new(),
        }
    }

    /// Notify the monitor endpoint about execution status
    ///
    /// This endpoint triggers:
    /// - Alert checking based on configured alert rules
    /// - Error analysis for failed executions
    /// - Pattern detection for multiple failures
    pub async fn notify_execution_status(
        &self,
        execution_id: i64,
        workflow_id: i64,
        workflow_name: Option<String>,
        status: ExecutionStatus,
        error_message: Option<String>,
        formatted_output: Option<Value>,
        started_at: Option<DateTime<Utc>>,
        completed_at: Option<DateTime<Utc>>,
        execution_time_seconds: Option<i64>,
        trigger_source: &str,
    ) -> Result<()> {
        let monitor_url = format!("{}/api/remote-workflows/executions/monitor", self.app_url);

        // Check if API key is configured
        let Some(ref api_key) = self.api_key else {
            error!("Cannot call monitor API - MEDIAR_SERVICE_API_KEY not configured");
            return Err(anyhow::anyhow!("MEDIAR_SERVICE_API_KEY not configured"));
        };

        // Build payload matching Modal's format
        let payload = json!({
            "execution": {
                "id": execution_id,
                "execution_id": execution_id,
                "workflow_id": workflow_id,
                "workflow_name": workflow_name,
                "status": match status {
                    ExecutionStatus::Completed => "completed",
                    ExecutionStatus::Failed => "failed",
                    ExecutionStatus::Cancelled => "cancelled",
                    ExecutionStatus::Running => "running",
                    ExecutionStatus::Queued => "queued",
                    ExecutionStatus::Paused => "paused",
                    ExecutionStatus::Exception => "exception",
                },
                "error_message": error_message,
                "formatted_output": formatted_output,
                "started_at": started_at.map(|dt| dt.to_rfc3339()),
                "completed_at": completed_at.map(|dt| dt.to_rfc3339()),
                "execution_time_seconds": execution_time_seconds,
                "trigger_source": trigger_source,
            }
        });

        info!(
            "Sending monitor notification for execution {} to {}",
            execution_id, monitor_url
        );

        // Make the API call with authentication
        let response = self
            .client
            .post(&monitor_url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&payload)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    info!(
                        "✅ Monitor notification sent successfully for execution {}",
                        execution_id
                    );
                    match resp.text().await {
                        Ok(text) => info!("Response: {}", text),
                        Err(e) => warn!("Could not read response body: {}", e),
                    }
                    Ok(())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_else(|_| "".to_string());
                    warn!("⚠️ Monitor notification failed: {} - {}", status, body);
                    Err(anyhow::anyhow!("Monitor API returned {status}: {body}"))
                }
            }
            Err(e) => {
                error!("❌ Failed to send monitor notification: {}", e);
                Err(anyhow::anyhow!("Monitor API request failed: {e}"))
            }
        }
    }

    /// Notify about a cancelled execution (due to failure patterns)
    pub async fn notify_cancelled(
        &self,
        execution_id: i64,
        workflow_id: i64,
        workflow_name: Option<String>,
        reason: &str,
    ) -> Result<()> {
        self.notify_execution_status(
            execution_id,
            workflow_id,
            workflow_name,
            ExecutionStatus::Cancelled,
            Some(reason.to_string()),
            None,
            Some(Utc::now()),
            Some(Utc::now()),
            Some(0),
            "rust_executor_cancelled",
        )
        .await
    }
}

impl Default for MonitorClient {
    fn default() -> Self {
        Self::new()
    }
}
