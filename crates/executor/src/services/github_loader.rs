use anyhow::{Context, Result};
use octocrab::Octocrab;
use tracing::{debug, info, warn};

pub struct GitHubLoader {
    client: Option<Octocrab>,
}

impl GitHubLoader {
    pub fn new(token: Option<String>) -> Self {
        let trace_id = crate::telemetry::current_trace_id().unwrap_or_default();

        let client = if let Some(token) = token {
            match Octocrab::builder().personal_token(token).build() {
                Ok(client) => Some(client),
                Err(e) => {
                    warn!(
                        trace_id = %trace_id,
                        error = %e,
                        "Failed to create GitHub client"
                    );
                    None
                }
            }
        } else {
            None
        };

        Self { client }
    }

    /// Load workflow YAML from GitHub
    pub async fn load_workflow(&self, folder: &str, git_ref: &str) -> Result<String> {
        let trace_id = crate::telemetry::current_trace_id().unwrap_or_default();

        let client = self
            .client
            .as_ref()
            .context("GitHub client not initialized")?;

        // Parse repository info
        let (owner, repo) = Self::parse_repo_info()?;

        // Fetch workflow.yaml from the specified folder
        let file_path = format!("{folder}/workflow.yaml");

        info!(
            trace_id = %trace_id,
            github_folder = %folder,
            github_ref = %git_ref,
            owner = %owner,
            repo = %repo,
            file_path = %file_path,
            "Loading workflow from GitHub"
        );

        debug!(
            trace_id = %trace_id,
            github_folder = %folder,
            github_ref = %git_ref,
            owner = %owner,
            repo = %repo,
            file_path = %file_path,
            "Fetching file from GitHub"
        );

        let content = client
            .repos(&owner, &repo)
            .get_content()
            .path(&file_path)
            .r#ref(git_ref)
            .send()
            .await
            .context("Failed to fetch workflow from GitHub")?;

        // Check if we got a file with content
        if !content.items.is_empty() {
            if let Some(file) = content.items.first() {
                if let Some(encoded_content) = &file.content {
                    // Decode base64 content
                    let decoded = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        encoded_content.replace('\n', ""),
                    )
                    .context("Failed to decode base64 content")?;

                    let yaml_content =
                        String::from_utf8(decoded).context("Invalid UTF-8 in workflow content")?;

                    info!(
                        trace_id = %trace_id,
                        github_folder = %folder,
                        github_ref = %git_ref,
                        content_length = %yaml_content.len(),
                        "Successfully loaded workflow from GitHub"
                    );

                    return Ok(yaml_content);
                }
            }
        }

        warn!(
            trace_id = %trace_id,
            github_folder = %folder,
            github_ref = %git_ref,
            "No content found in GitHub response"
        );
        anyhow::bail!("No content found in GitHub response")
    }

    /// Parse repository info from environment or config
    fn parse_repo_info() -> Result<(String, String)> {
        // Default to mediar-ai/workflows repository
        let repo =
            std::env::var("GITHUB_REPO").unwrap_or_else(|_| "mediar-ai/workflows".to_string());

        let parts: Vec<&str> = repo.split('/').collect();
        if parts.len() != 2 {
            anyhow::bail!("Invalid repository format. Expected owner/repo");
        }

        Ok((parts[0].to_string(), parts[1].to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_github_loader_creation_without_token() {
        // Test without token - doesn't require async runtime
        let loader = GitHubLoader::new(None);
        assert!(loader.client.is_none());
    }

    #[tokio::test]
    async fn test_github_loader_creation_with_token() {
        // Test with token - requires async runtime for Octocrab
        let _loader_with_token = GitHubLoader::new(Some("test_token".to_string()));
        // Can't assert client is Some without actual valid token in test environment
    }

    #[test]
    fn test_parse_repo_info() {
        std::env::set_var("GITHUB_REPO", "test/repo");
        let result = GitHubLoader::parse_repo_info();
        assert!(result.is_ok());
        let (owner, repo) = result.unwrap();
        assert_eq!(owner, "test");
        assert_eq!(repo, "repo");
        std::env::remove_var("GITHUB_REPO");
    }
}
