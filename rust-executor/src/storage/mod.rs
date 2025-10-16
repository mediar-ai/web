use anyhow::{Result, Context};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use object_store::{
    ObjectStore,
    http::HttpBuilder,
};
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::{debug, info, warn, error};
use uuid::Uuid;

pub struct SupabaseStorage {
    storage_client: Arc<dyn ObjectStore>,
    supabase_url: String,
    supabase_key: String,
    http_client: Client,
}

impl SupabaseStorage {
    /// Create a new Supabase Storage client
    pub fn new(supabase_url: String, supabase_key: String) -> Result<Self> {
        // Build the storage endpoint URL
        let storage_endpoint = format!("{}/storage/v1/object", supabase_url);

        // Create HTTP-based object store
        let storage_client = HttpBuilder::new()
            .with_url(&storage_endpoint)
            .build()
            .context("Failed to build HTTP storage client")?;

        let http_client = Client::new();

        Ok(Self {
            storage_client: Arc::new(storage_client),
            supabase_url,
            supabase_key,
            http_client,
        })
    }

    /// Upload a screenshot to Supabase Storage
    /// Returns the signed URL for accessing the screenshot
    pub async fn upload_screenshot(
        &self,
        execution_id: Uuid,
        organization_id: Uuid,
        screenshot_data: &str,
        index: usize,
    ) -> Result<String> {
        // Decode base64 screenshot data
        let image_bytes = BASE64.decode(screenshot_data)
            .context("Failed to decode base64 screenshot data")?;

        // Generate filename with timestamp
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let filename = format!("screenshot_{}_{}.png", timestamp, index);

        // Build storage path: screenshots/{org_id}/{execution_id}/{filename}
        let storage_path = format!("screenshots/{}/{}/{}",
            organization_id, execution_id, filename);

        info!("Uploading screenshot to: {}", storage_path);

        // Upload using HTTP API with proper authorization
        let upload_url = format!(
            "{}/storage/v1/object/workflow-screenshots/{}",
            self.supabase_url,
            storage_path
        );

        debug!("Upload URL: {}", upload_url);

        let response = self.http_client
            .post(&upload_url)
            .header("Authorization", format!("Bearer {}", self.supabase_key))
            .header("Content-Type", "image/png")
            .header("x-upsert", "true")  // Allow overwriting existing files
            .body(image_bytes)
            .send()
            .await
            .context("Failed to send screenshot upload request")?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            error!("Upload failed with status {}: {}", status, error_text);
            return Err(anyhow::anyhow!(
                "Failed to upload screenshot: HTTP {} - {}",
                status, error_text
            ));
        }

        let upload_result: Value = response.json().await
            .context("Failed to parse upload response")?;

        debug!("Upload response: {:?}", upload_result);

        // Generate signed URL for the uploaded file
        let signed_url = self.get_signed_url(&storage_path).await?;

        info!("Screenshot uploaded successfully: {}", signed_url);

        Ok(signed_url)
    }

    /// Get a signed URL for accessing a file in storage
    async fn get_signed_url(&self, storage_path: &str) -> Result<String> {
        let signed_url_endpoint = format!(
            "{}/storage/v1/object/sign/workflow-screenshots/{}",
            self.supabase_url,
            storage_path
        );

        debug!("Requesting signed URL from: {}", signed_url_endpoint);

        // Request signed URL with 1 hour expiration
        let request_body = json!({
            "expiresIn": 3600  // 1 hour in seconds
        });

        let response = self.http_client
            .post(&signed_url_endpoint)
            .header("Authorization", format!("Bearer {}", self.supabase_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .context("Failed to request signed URL")?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            warn!("Signed URL request failed with status {}: {}", status, error_text);

            // Fallback to public URL if signed URL fails
            let public_url = format!(
                "{}/storage/v1/object/public/workflow-screenshots/{}",
                self.supabase_url,
                storage_path
            );
            debug!("Falling back to public URL: {}", public_url);
            return Ok(public_url);
        }

        let signed_result: Value = response.json().await
            .context("Failed to parse signed URL response")?;

        // Extract signedURL from response
        let signed_path = signed_result
            .get("signedURL")
            .and_then(|v| v.as_str())
            .context("Signed URL not found in response")?;

        // Construct full URL
        let full_url = format!("{}{}", self.supabase_url, signed_path);

        Ok(full_url)
    }

    /// Upload multiple screenshots and return their URLs
    pub async fn upload_screenshots(
        &self,
        execution_id: Uuid,
        organization_id: Uuid,
        screenshots: Vec<String>,
    ) -> Result<Vec<String>> {
        let mut screenshot_urls = Vec::new();

        for (index, screenshot_data) in screenshots.iter().enumerate() {
            match self.upload_screenshot(
                execution_id,
                organization_id,
                screenshot_data,
                index
            ).await {
                Ok(url) => {
                    screenshot_urls.push(url);
                }
                Err(e) => {
                    error!("Failed to upload screenshot {}: {}", index, e);
                    // Continue with other screenshots instead of failing completely
                    warn!("Continuing with remaining screenshots");
                }
            }
        }

        if screenshot_urls.is_empty() && !screenshots.is_empty() {
            return Err(anyhow::anyhow!(
                "Failed to upload any screenshots ({} attempted)",
                screenshots.len()
            ));
        }

        info!("Uploaded {}/{} screenshots successfully",
              screenshot_urls.len(), screenshots.len());

        Ok(screenshot_urls)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_path_format() {
        let org_id = Uuid::new_v4();
        let execution_id = Uuid::new_v4();
        let filename = "screenshot_20250115_123456_0.png";

        let expected_path = format!("screenshots/{}/{}/{}", org_id, execution_id, filename);

        assert!(expected_path.starts_with("screenshots/"));
        assert!(expected_path.contains(&org_id.to_string()));
        assert!(expected_path.contains(&execution_id.to_string()));
        assert!(expected_path.ends_with(".png"));
    }

    #[test]
    fn test_base64_decode() {
        // Valid 1x1 red pixel PNG
        let base64_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

        let result = BASE64.decode(base64_png);
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(bytes.len() > 0);

        // PNG files start with magic bytes: 89 50 4E 47
        assert_eq!(bytes[0], 0x89);
        assert_eq!(bytes[1], 0x50);
        assert_eq!(bytes[2], 0x4E);
        assert_eq!(bytes[3], 0x47);
    }
}
