//! # Workflow API Client
//!
//! Client for interacting with the Mediar cloud workflow API.
//!
//! ## Deprecation Notice
//!
//! This client was originally designed for YAML workflows with numeric (i64) IDs.
//! TypeScript workflows now use UUID string IDs (`github_folder`).
//!
//! ### Deprecated Functions (YAML-specific):
//! - `get_workflow` - Returns YAML content, use TypeScript file reading instead
//! - `update_workflow_content` - Updates YAML content
//! - `json_to_yaml` / `yaml_to_json` - YAML conversion utilities
//!
//! ### Still Active Functions:
//! - `list_workflows` - Lists all workflows (frontend filters by `github_folder`)
//! - `update_workflow_metadata` - Updates name/description
//! - `delete_workflow` - Deletes any workflow
//! - `delete_latest_workflow_version` - Reverts to previous version
//! - `duplicate_workflow` - Clones a workflow
//! - `list_all_organizations` - Admin function
//!
//! Note: The backend still uses i64 IDs internally. The frontend maps `github_folder`
//! (UUID string) as the workflow ID for TypeScript workflows.

use crate::auth::retrieve_auth_token;
use log::{error, info};
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// Get API base URL (matches auth.rs pattern)
fn get_api_base() -> String {
    std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string())
}

/// Version information from the API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub current_version: String,
    pub total_versions: i32,
    /// Latest version by created_at (most recently created version)
    pub latest_version: Option<String>,
}

/// Workflow response from the API (matches backend schema)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiWorkflow {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub automation_sequence: Option<serde_json::Value>, // JSON object
    pub automation_sequence_yaml: Option<String>,       // YAML string
    pub org_id: Option<String>,
    pub deployment_status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_activity_at: Option<String>, // When workflow was last active (execution completed)
    pub last_modified_at: Option<String>, // When workflow definition was last modified
    // Permission/Ownership fields
    pub created_by: Option<String>,
    pub organization_id: Option<String>,
    pub is_public: Option<bool>,
    // User's access level for this workflow ('owner', 'admin', 'write', 'read', 'public_read')
    pub user_access_level: Option<String>,
    // Author info (first user in organization)
    pub author_name: Option<String>,
    // Version information
    pub version_info: Option<VersionInfo>,
    // TypeScript workflow UUID folder name
    pub github_folder: Option<String>,
    // Workflow UUID for zip download endpoint
    pub uuid: Option<String>,    // Step count from database (pre-computed)
    pub step_count: Option<i32>,
    // Tags for filtering/categorization
    pub tags: Option<Vec<String>>,
    // Featured workflows (demo/onboarding) - always shown to users
    pub is_featured: Option<bool>,
}

/// Wrapper for GET /api/remote-workflows/{id} response
#[derive(Debug, Deserialize)]
struct GetWorkflowResponse {
    success: bool,
    workflow: GetWorkflowDetails,
    #[allow(dead_code)] // Returned by API but not used by desktop client
    timestamp: String,
}

/// Workflow details from GET endpoint (different from ApiWorkflow)
#[derive(Debug, Deserialize)]
struct GetWorkflowDetails {
    id: i64,
    name: String,
    status: Option<String>, // Note: called "status" not "deployment_status"
    #[allow(dead_code)] // Returned by API but not used by desktop client
    source: Option<String>,
    #[allow(dead_code)] // Returned by API but not used by desktop client
    github_path: Option<String>,
    #[allow(dead_code)] // Returned by API but not used by desktop client
    github_sha: Option<String>,
    automation_sequence: Option<serde_json::Value>,
    // Permission/Ownership fields
    created_by: Option<String>,
    organization_id: Option<String>,
    is_public: Option<bool>,
    // Fields added by cloud API but not used by desktop client
    #[allow(dead_code)]
    #[serde(skip_serializing_if = "Option::is_none")]
    trigger_info: Option<serde_json::Value>,
    #[allow(dead_code)]
    #[serde(skip_serializing_if = "Option::is_none")]
    usage_examples: Option<serde_json::Value>,
}

/// Workflow summary for list views (what the UI displays)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSummary {
    pub id: i64,
    pub name: String,
    pub description: String, // Default to empty string if None
    pub step_count: i32,
    pub last_modified: String, // ISO timestamp
    pub created_at: String,    // ISO timestamp
    // Permission/Ownership fields for frontend authorization
    pub created_by: Option<String>,
    pub organization_id: Option<String>,
    pub is_public: Option<bool>,
    /// User's access level: 'owner', 'admin', 'write', 'read', 'public_read'
    pub user_access_level: Option<String>,
    // Author info (first user in organization)
    pub author_name: Option<String>,
    // Version information
    pub current_version: Option<String>,
    pub total_versions: Option<i32>,
    /// Latest version by created_at (most recently created version)
    pub latest_version: Option<String>,
    /// UUID folder name for TypeScript workflows - used to identify cloud-only workflows
    pub github_folder: Option<String>,
    /// Workflow UUID for zip download endpoint
    pub uuid: Option<String>,
    /// Tags for filtering/categorization
    pub tags: Vec<String>,
    /// Featured workflows (demo/onboarding) - always shown to users
    pub is_featured: Option<bool>,
}

/// Organization info for admin view
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub org_type: String,
    #[serde(rename = "workflowCount")]
    pub workflow_count: i32,
}

/// Response from /api/admin/list-all-orgs
#[derive(Debug, Serialize, Deserialize)]
pub struct ListOrgsResponse {
    pub success: Option<bool>,
    pub organizations: Vec<Organization>,
    #[serde(rename = "totalOrganizations")]
    pub total_organizations: Option<i32>,
    #[serde(rename = "isMediarAdmin")]
    pub is_mediar_admin: bool,
}

impl From<ApiWorkflow> for WorkflowSummary {
    fn from(api_workflow: ApiWorkflow) -> Self {
        // Use step_count from API if available (pre-computed in database)
        // Fall back to counting from automation_sequence for backward compatibility
        if let Some(count) = api_workflow.step_count {
            return WorkflowSummary {
                id: api_workflow.id,
                name: api_workflow.name,
                description: api_workflow.description.unwrap_or_default(),
                step_count: count,
                last_modified: api_workflow
                    .last_modified_at
                    .clone()
                    .or_else(|| api_workflow.updated_at.clone())
                    .or_else(|| api_workflow.created_at.clone())
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                created_at: api_workflow
                    .created_at
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                created_by: api_workflow.created_by,
                organization_id: api_workflow.organization_id,
                is_public: api_workflow.is_public,
                user_access_level: api_workflow.user_access_level,
                author_name: api_workflow.author_name,
                current_version: api_workflow
                    .version_info
                    .as_ref()
                    .map(|v| v.current_version.clone()),
                total_versions: api_workflow.version_info.as_ref().map(|v| v.total_versions),
                latest_version: api_workflow
                    .version_info
                    .as_ref()
                    .and_then(|v| v.latest_version.clone()),
                github_folder: api_workflow.github_folder.clone(),
                uuid: api_workflow.uuid,
                tags: api_workflow.tags.clone().unwrap_or_default(),
                is_featured: api_workflow.is_featured,
            };
        }

        // Fallback: Count steps from automation_sequence if available
        // Handle multiple formats stored in the database:
        // Format 1: Unwrapped object { steps: [...], variables: {...} }
        // Format 2: Wrapped object { tool_name: "execute_sequence", arguments: { steps: [...] } }
        // Format 3: Array wrapper [{ tool_name: "execute_sequence", arguments: { steps: [...] } }]
        let step_count = if let Some(seq) = &api_workflow.automation_sequence {
            // Try Format 1 & 2: Object (unwrapped or wrapped)
            if let Some(obj) = seq.as_object() {
                // Format 1: Check for direct steps key (unwrapped)
                if let Some(steps) = obj.get("steps").and_then(|s| s.as_array()) {
                    return WorkflowSummary {
                        id: api_workflow.id,
                        name: api_workflow.name,
                        description: api_workflow.description.unwrap_or_default(),
                        step_count: steps.len() as i32,
                        last_modified: api_workflow
                            .last_modified_at
                            .clone()
                            .or_else(|| api_workflow.updated_at.clone())
                            .or_else(|| api_workflow.created_at.clone())
                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                        created_at: api_workflow
                            .created_at
                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                        created_by: api_workflow.created_by.clone(),
                        organization_id: api_workflow.organization_id.clone(),
                        is_public: api_workflow.is_public,
                        user_access_level: api_workflow.user_access_level.clone(),
                        author_name: api_workflow.author_name.clone(),
                        current_version: api_workflow
                            .version_info
                            .as_ref()
                            .map(|v| v.current_version.clone()),
                        total_versions: api_workflow.version_info.as_ref().map(|v| v.total_versions),
                        latest_version: api_workflow
                            .version_info
                            .as_ref()
                            .and_then(|v| v.latest_version.clone()),
                        github_folder: api_workflow.github_folder.clone(),
                        uuid: api_workflow.uuid.clone(),
                        tags: api_workflow.tags.clone().unwrap_or_default(),
                        is_featured: api_workflow.is_featured,
                    };
                }
                // Format 2: Check for wrapped format (arguments.steps)
                if let Some(args) = obj.get("arguments").and_then(|a| a.as_object()) {
                    if let Some(steps) = args.get("steps").and_then(|s| s.as_array()) {
                        return WorkflowSummary {
                            id: api_workflow.id,
                            name: api_workflow.name,
                            description: api_workflow.description.unwrap_or_default(),
                            step_count: steps.len() as i32,
                            last_modified: api_workflow
                                .last_modified_at
                                .clone()
                                .or_else(|| api_workflow.updated_at.clone())
                                .or_else(|| api_workflow.created_at.clone())
                                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                            created_at: api_workflow
                                .created_at
                                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                            created_by: api_workflow.created_by.clone(),
                            organization_id: api_workflow.organization_id.clone(),
                            is_public: api_workflow.is_public,
                            user_access_level: api_workflow.user_access_level.clone(),
                            author_name: api_workflow.author_name.clone(),
                            current_version: api_workflow
                                .version_info
                                .as_ref()
                                .map(|v| v.current_version.clone()),
                            total_versions: api_workflow.version_info.as_ref().map(|v| v.total_versions),
                            latest_version: api_workflow
                                .version_info
                                .as_ref()
                                .and_then(|v| v.latest_version.clone()),
                            github_folder: api_workflow.github_folder.clone(),
                            uuid: api_workflow.uuid.clone(),
                            tags: api_workflow.tags.clone().unwrap_or_default(),
                            is_featured: api_workflow.is_featured,
                        };
                    }
                }
            }
            // Try Format 3: Array wrapper [{ arguments: { steps } }]
            if let Some(arr) = seq.as_array() {
                // First check if it's a wrapped format
                if let Some(wrapper) = arr.first() {
                    if let Some(args) = wrapper.get("arguments") {
                        if let Some(steps) = args.get("steps").and_then(|s| s.as_array()) {
                            return WorkflowSummary {
                                id: api_workflow.id,
                                name: api_workflow.name,
                                description: api_workflow.description.unwrap_or_default(),
                                step_count: steps.len() as i32,
                                last_modified: api_workflow
                                    .last_modified_at
                                    .clone()
                                    .or_else(|| api_workflow.updated_at.clone())
                                    .or_else(|| api_workflow.created_at.clone())
                                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                created_at: api_workflow
                                    .created_at
                                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                created_by: api_workflow.created_by.clone(),
                                organization_id: api_workflow.organization_id.clone(),
                                is_public: api_workflow.is_public,
                                user_access_level: api_workflow.user_access_level.clone(),
                                author_name: api_workflow.author_name.clone(),
                                current_version: api_workflow
                                    .version_info
                                    .as_ref()
                                    .map(|v| v.current_version.clone()),
                                total_versions: api_workflow.version_info.as_ref().map(|v| v.total_versions),
                                latest_version: api_workflow
                                    .version_info
                                    .as_ref()
                                    .and_then(|v| v.latest_version.clone()),
                                github_folder: api_workflow.github_folder.clone(),
                                uuid: api_workflow.uuid.clone(),
                                tags: api_workflow.tags.clone().unwrap_or_default(),
                                is_featured: api_workflow.is_featured,
                            };
                        }
                    }
                }
                // Format 4: Direct array of steps (most common case from API)
                // If it's not wrapped, treat the entire array as the steps array
                // This handles: [{tool_name: "click", ...}, {tool_name: "type", ...}]
                arr.len() as i32
            } else {
                0
            }
        } else if let Some(yaml) = &api_workflow.automation_sequence_yaml {
            // Fallback: rough count by looking for "- tool_name:" in YAML
            yaml.matches("tool_name:").count() as i32
        } else {
            0
        };

        WorkflowSummary {
            id: api_workflow.id,
            name: api_workflow.name,
            description: api_workflow.description.unwrap_or_default(),
            step_count,
            last_modified: api_workflow
                .last_modified_at
                .clone()
                .or_else(|| api_workflow.updated_at.clone())
                .or_else(|| api_workflow.created_at.clone())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            created_at: api_workflow
                .created_at
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            created_by: api_workflow.created_by,
            organization_id: api_workflow.organization_id,
            is_public: api_workflow.is_public,
            user_access_level: api_workflow.user_access_level,
            author_name: api_workflow.author_name,
            current_version: api_workflow
                .version_info
                .as_ref()
                .map(|v| v.current_version.clone()),
            total_versions: api_workflow.version_info.as_ref().map(|v| v.total_versions),
            latest_version: api_workflow
                .version_info
                .as_ref()
                .and_then(|v| v.latest_version.clone()),
            github_folder: api_workflow.github_folder,
            uuid: api_workflow.uuid,
            tags: api_workflow.tags.unwrap_or_default(),
            is_featured: api_workflow.is_featured,
        }
    }
}

/// List workflows response
#[derive(Debug, Deserialize)]
struct ListWorkflowsResponse {
    workflows: Vec<ApiWorkflow>,
}

/// Create workflow request
#[derive(Debug, Serialize)]
struct CreateWorkflowRequest {
    name: String,
    description: Option<String>,
    automation_sequence: String, // YAML string
    sequence_format: String,     // "yaml"
    deployment_status: String,   // "pending" for desktop workflows
}

/// Create workflow response wrapper (matches backend API format)
#[derive(Debug, Deserialize)]
struct CreateWorkflowResponse {
    success: bool,
    workflow: ApiWorkflowWithVersion,
    message: String,
}

/// Version details from create/duplicate response (full version record)
#[derive(Debug, Deserialize)]
struct WorkflowVersionDetails {
    #[allow(dead_code)]
    id: Option<i64>,
    #[allow(dead_code)]
    workflow_id: Option<i64>,
    version_number: String, // The semantic version like "1.0.0"
    #[allow(dead_code)]
    automation_sequence_yaml: Option<String>,
    #[allow(dead_code)]
    automation_sequence: Option<serde_json::Value>,
    #[allow(dead_code)]
    preferred_format: Option<String>,
    #[allow(dead_code)]
    is_active: Option<bool>,
    #[allow(dead_code)]
    change_notes: Option<String>,
    #[allow(dead_code)]
    created_at: Option<String>,
}

/// Workflow with version info (returned by create endpoint)
#[derive(Debug, Deserialize)]
struct ApiWorkflowWithVersion {
    id: i64,
    name: String,
    description: Option<String>,
    automation_sequence: Option<serde_json::Value>,
    organization_id: Option<String>,
    created_by: Option<String>,
    status: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    // Additional fields from create response - returned by API but not used yet
    #[allow(dead_code)]
    version: Option<String>,
    #[allow(dead_code)]
    workflow_type: Option<String>,
    // Version info returned by create/duplicate endpoints
    version_info: Option<WorkflowVersionDetails>,
}

/// Update workflow version request
#[derive(Debug, Serialize)]
struct UpdateWorkflowVersionRequest {
    automation_sequence: String, // YAML string
    sequence_format: String,     // "yaml"
}

/// Update workflow metadata request
#[derive(Debug, Serialize)]
struct UpdateWorkflowMetadataRequest {
    name: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
struct UpdateWorkflowTagsRequest {
    tags: Vec<String>,
}

/// Get authentication token or return error
async fn get_auth_token() -> Result<String, String> {
    match retrieve_auth_token()? {
        Some(token) => Ok(token),
        None => Err("Not authenticated. Please log in first.".to_string()),
    }
}

/// List all desktop workflows (deployment_status = 'pending')
/// If view_org_id is provided, fetches workflows for that org (admin only)
pub async fn list_workflows(view_org_id: Option<String>) -> Result<Vec<WorkflowSummary>, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    // Add version=latest parameter to get the latest version for desktop
    // Add viewOrgId if provided for admin org switching
    // Add limit=500 to load more workflows (default is 50)
    let url = match &view_org_id {
        Some(org_id) if !org_id.is_empty() => {
            format!(
                "{}/api/remote-workflows/list?version=latest&limit=500&viewOrgId={}",
                api_base, org_id
            )
        }
        _ => format!(
            "{}/api/remote-workflows/list?version=latest&limit=500",
            api_base
        ),
    };

    info!(
        "📋 Fetching workflows from: {} (using latest versions)",
        url
    );

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error listing workflows: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!("❌ Failed to list workflows: {} - {}", status, error_text);
        return Err(format!(
            "Network error: Failed to retrieve workflows from server (status: {})",
            status
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let response_data: ListWorkflowsResponse =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse workflows response: {}", e))?;

    // Convert ApiWorkflow to WorkflowSummary
    let summaries: Vec<WorkflowSummary> = response_data
        .workflows
        .into_iter()
        .map(WorkflowSummary::from)
        .collect();

    info!("✅ Retrieved {} workflows", summaries.len());
    Ok(summaries)
}

/// List all community/public workflows (is_public = true)
/// These are workflows shared by the community, shown separately from user's workflows
pub async fn list_community_workflows() -> Result<Vec<WorkflowSummary>, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    // Use the community endpoint with version=latest for desktop
    let url = format!(
        "{}/api/remote-workflows/community?version=latest&limit=100",
        api_base
    );

    info!("🌐 Fetching community workflows from: {}", url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error listing community workflows: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!("❌ Failed to list community workflows: {} - {}", status, error_text);
        return Err(format!(
            "Network error: Failed to retrieve community workflows (status: {})",
            status
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let response_data: ListWorkflowsResponse =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse community workflows response: {}", e))?;

    // Convert ApiWorkflow to WorkflowSummary
    let summaries: Vec<WorkflowSummary> = response_data
        .workflows
        .into_iter()
        .map(WorkflowSummary::from)
        .collect();

    info!("✅ Retrieved {} community workflows", summaries.len());
    Ok(summaries)
}

/// Get a single workflow by ID
///
/// **DEPRECATED**: This function is for YAML workflows. TypeScript workflows
/// should use `read_typescript_workflow_files` command instead.
pub async fn get_workflow(workflow_id: i64) -> Result<ApiWorkflow, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/remote-workflows/{}", api_base, workflow_id);

    info!("📄 Fetching workflow {} from: {}", workflow_id, url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error getting workflow: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to get workflow {}: {} - {}",
            workflow_id, status, error_text
        );
        return Err(format!("Failed to get workflow: {}", status));
    }

    // Parse the wrapped response format: { success, workflow, timestamp }
    let wrapped_response: GetWorkflowResponse = match response.json().await {
        Ok(r) => r,
        Err(e) => {
            error!(
                "❌ Failed to deserialize workflow {} response: {:?}",
                workflow_id, e
            );
            return Err(format!("Failed to parse workflow response: {}", e));
        }
    };

    if !wrapped_response.success {
        error!("❌ API returned success=false for workflow {}", workflow_id);
        return Err(format!("API returned error for workflow {}", workflow_id));
    }

    let details = wrapped_response.workflow;

    // Convert automation_sequence to YAML string if needed
    let automation_sequence_yaml = if let Some(ref seq) = details.automation_sequence {
        match serde_yaml::to_string(seq) {
            Ok(yaml) => Some(yaml),
            Err(e) => {
                error!("⚠️ Failed to convert automation_sequence to YAML: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Convert GetWorkflowDetails to ApiWorkflow format
    let workflow = ApiWorkflow {
        id: details.id,
        name: details.name.clone(),
        description: None, // Not provided by GET endpoint
        automation_sequence: details.automation_sequence,
        automation_sequence_yaml,
        org_id: None, // Not provided by GET endpoint
        deployment_status: details.status,
        created_at: None,       // Not provided by GET endpoint
        updated_at: None,       // Not provided by GET endpoint
        last_activity_at: None, // Not provided by GET endpoint
        last_modified_at: None, // Not provided by GET endpoint
        created_by: details.created_by,
        organization_id: details.organization_id,
        is_public: details.is_public,
        author_name: None,       // Not provided by GET endpoint
        user_access_level: None, // Not provided by GET endpoint
        version_info: None,      // Not provided by GET endpoint
        github_folder: None,     // Not provided by GET endpoint
        uuid: None,              // Not provided by GET endpoint
        step_count: None,        // Will be computed from automation_sequence
        tags: None,              // Not provided by GET endpoint
        is_featured: None,       // Not provided by GET endpoint
    };

    info!("✅ Retrieved workflow: {}", workflow.name);
    Ok(workflow)
}

/// Create a new workflow
pub async fn create_workflow(
    name: String,
    description: Option<String>,
    yaml_content: String,
) -> Result<ApiWorkflow, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/workflows/create", api_base);

    info!("📝 Creating workflow '{}' at: {}", name, url);

    let request_body = CreateWorkflowRequest {
        name: name.clone(),
        description,
        automation_sequence: yaml_content,
        sequence_format: "yaml".to_string(),
        deployment_status: "pending".to_string(), // Desktop workflows are 'pending'
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error creating workflow: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to create workflow '{}': {} - {}",
            name, status, error_text
        );
        return Err(format!("Failed to create workflow: {}", status));
    }

    // Parse wrapped response from API
    let wrapped_response: CreateWorkflowResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse create response: {}", e))?;

    if !wrapped_response.success {
        error!("❌ API returned success=false for workflow creation");
        return Err(format!("API error: {}", wrapped_response.message));
    }

    info!(
        "✅ Created workflow '{}' with ID: {}",
        name, wrapped_response.workflow.id
    );

    // Extract version info from response
    let version_info = wrapped_response.workflow.version_info.map(|v| {
        info!("📦 Workflow created with version: {}", v.version_number);
        VersionInfo {
            current_version: v.version_number.clone(),
            total_versions: 1,                      // First version when creating
            latest_version: Some(v.version_number), // For new workflow, latest = current
        }
    });

    // Convert to ApiWorkflow format
    let workflow = ApiWorkflow {
        id: wrapped_response.workflow.id,
        name: wrapped_response.workflow.name,
        description: wrapped_response.workflow.description,
        automation_sequence: wrapped_response.workflow.automation_sequence,
        automation_sequence_yaml: None, // Not provided by create endpoint
        org_id: wrapped_response.workflow.organization_id.clone(),
        deployment_status: wrapped_response.workflow.status,
        created_at: wrapped_response.workflow.created_at,
        updated_at: wrapped_response.workflow.updated_at,
        last_activity_at: None, // Not provided by create endpoint
        last_modified_at: None, // Not provided by create endpoint
        created_by: wrapped_response.workflow.created_by,
        organization_id: wrapped_response.workflow.organization_id,
        is_public: None,         // Not provided by create endpoint
        author_name: None,       // Not provided by create endpoint
        user_access_level: None, // Not provided by create endpoint
        version_info,
        github_folder: None, // Not provided by create endpoint
        uuid: None,          // Not provided by create endpoint
        step_count: None,    // Will be computed from automation_sequence
        tags: None,          // Not provided by create endpoint
        is_featured: None,   // Not provided by create endpoint
    };

    Ok(workflow)
}

/// Update workflow YAML content (creates a new version)
///
/// **DEPRECATED**: This function is for YAML workflows. TypeScript workflows
/// should use `write_typescript_workflow_file` and `sync_typescript_workflow` instead.
pub async fn update_workflow_content(workflow_id: i64, yaml_content: String) -> Result<(), String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/remote-workflows/{}/versions", api_base, workflow_id);

    info!("💾 Updating workflow {} content at: {}", workflow_id, url);

    let request_body = UpdateWorkflowVersionRequest {
        automation_sequence: yaml_content,
        sequence_format: "yaml".to_string(),
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error updating workflow: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to update workflow {}: {} - {}",
            workflow_id, status, error_text
        );

        // Provide user-friendly error message for permission denied
        if status == 403 {
            return Err("Access denied: You can't edit this workflow".to_string());
        }

        return Err(format!("Failed to update workflow: {}", status));
    }

    info!("✅ Updated workflow {} content", workflow_id);
    Ok(())
}

/// Update workflow metadata (name, description)
pub async fn update_workflow_metadata(
    workflow_id: i64,
    name: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/remote-workflows/{}", api_base, workflow_id);

    info!("✏️ Updating workflow {} metadata at: {}", workflow_id, url);

    let request_body = UpdateWorkflowMetadataRequest { name, description };

    let response = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error updating metadata: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to update workflow {} metadata: {} - {}",
            workflow_id, status, error_text
        );
        return Err(format!("Failed to update metadata: {}", status));
    }

    info!("✅ Updated workflow {} metadata", workflow_id);
    Ok(())
}

/// Update workflow tags
pub async fn update_workflow_tags(workflow_id: i64, tags: Vec<String>) -> Result<(), String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/remote-workflows/{}", api_base, workflow_id);

    info!(
        "🏷️ Updating workflow {} tags to {:?} at: {}",
        workflow_id, tags, url
    );

    let request_body = UpdateWorkflowTagsRequest { tags };

    let response = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error updating tags: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to update workflow {} tags: {} - {}",
            workflow_id, status, error_text
        );
        return Err(format!("Failed to update tags: {}", status));
    }

    info!("✅ Updated workflow {} tags", workflow_id);
    Ok(())
}

/// Delete a workflow
pub async fn delete_workflow(workflow_id: i64) -> Result<(), String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/remote-workflows/{}", api_base, workflow_id);

    info!("🗑️ Deleting workflow {} at: {}", workflow_id, url);

    let response = client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error deleting workflow: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to delete workflow {}: {} - {}",
            workflow_id, status, error_text
        );
        return Err(format!("Failed to delete workflow: {}", status));
    }

    info!("✅ Deleted workflow {}", workflow_id);
    Ok(())
}

/// Delete the latest version of a workflow (rollback mechanism)
pub async fn delete_latest_workflow_version(workflow_id: i64) -> Result<(), String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!(
        "{}/api/remote-workflows/{}/versions/latest",
        api_base, workflow_id
    );

    info!(
        "⏪ Deleting latest version of workflow {} at: {}",
        workflow_id, url
    );

    let response = client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error deleting version: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to delete latest version of workflow {}: {} - {}",
            workflow_id, status, error_text
        );

        // Parse specific error reasons for user-friendly messages
        if error_text.contains("ONLY_VERSION") {
            return Err("Cannot revert: This is the only version of the workflow".to_string());
        } else if error_text.contains("IS_CURRENT_VERSION") {
            return Err("Cannot revert: This version is currently deployed".to_string());
        } else if error_text.contains("HAS_EXECUTIONS") {
            return Err("Cannot revert: This version has execution history".to_string());
        }

        return Err(format!("Failed to delete latest version: {}", error_text));
    }

    info!("✅ Deleted latest version of workflow {}", workflow_id);
    Ok(())
}

/// Duplicate workflow response wrapper (matches backend API format)
#[derive(Debug, Deserialize)]
struct DuplicateWorkflowResponse {
    success: bool,
    workflow: ApiWorkflowWithVersion,
    message: String,
    #[allow(dead_code)]
    original_workflow_id: i64,
}

/// Duplicate an existing workflow with "CLONED " prefix
/// workflow_id can be either numeric ID or UUID (github_folder for TypeScript workflows)
pub async fn duplicate_workflow(workflow_id: &str, original_name: String) -> Result<ApiWorkflow, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    // Add version=latest to get the latest version for desktop (not the stale active version)
    let url = format!(
        "{}/api/workflows/{}/duplicate?version=latest",
        api_base, workflow_id
    );

    // Generate new name with CLONED prefix
    let cloned_name = format!("CLONED {}", original_name);

    info!(
        "🔄 [CLONE] Duplicating workflow {} as '{}' at: {}",
        workflow_id, cloned_name, url
    );

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "name": cloned_name
        }))
        .send()
        .await
        .map_err(|e| format!("Network error duplicating workflow: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to duplicate workflow {}: {} - {}",
            workflow_id, status, error_text
        );
        return Err(format!("Failed to duplicate workflow: {}", status));
    }

    // Parse wrapped response from API
    let wrapped_response: DuplicateWorkflowResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse duplicate response: {}", e))?;

    if !wrapped_response.success {
        error!("❌ API returned success=false for workflow duplication");
        return Err(format!("API error: {}", wrapped_response.message));
    }

    info!(
        "✅ Duplicated workflow {} as '{}' with ID: {}",
        workflow_id, wrapped_response.workflow.name, wrapped_response.workflow.id
    );

    // Extract version info from response
    let version_info = wrapped_response.workflow.version_info.map(|v| {
        info!(
            "📦 Duplicated workflow created with version: {}",
            v.version_number
        );
        VersionInfo {
            current_version: v.version_number.clone(),
            total_versions: 1,                      // First version of the duplicate
            latest_version: Some(v.version_number), // For new duplicate, latest = current
        }
    });

    // Convert to ApiWorkflow format
    let workflow = ApiWorkflow {
        id: wrapped_response.workflow.id,
        name: wrapped_response.workflow.name,
        description: wrapped_response.workflow.description,
        automation_sequence: wrapped_response.workflow.automation_sequence,
        automation_sequence_yaml: None, // Not provided by duplicate endpoint
        org_id: wrapped_response.workflow.organization_id.clone(),
        deployment_status: wrapped_response.workflow.status,
        created_at: wrapped_response.workflow.created_at,
        updated_at: wrapped_response.workflow.updated_at,
        last_activity_at: None, // Not provided by duplicate endpoint
        last_modified_at: None, // Not provided by duplicate endpoint
        created_by: wrapped_response.workflow.created_by,
        organization_id: wrapped_response.workflow.organization_id,
        is_public: None,         // Not provided by duplicate endpoint
        author_name: None,       // Not provided by duplicate endpoint
        user_access_level: None, // Not provided by duplicate endpoint
        version_info,
        github_folder: None, // Not provided by duplicate endpoint
        uuid: None,          // Not provided by duplicate endpoint
        step_count: None,    // Will be computed from automation_sequence
        tags: None,          // Not provided by duplicate endpoint
        is_featured: None,   // Not provided by duplicate endpoint
    };

    Ok(workflow)
}

/// Response from visibility endpoint
#[derive(Debug, Deserialize)]
struct VisibilityResponse {
    success: bool,
    is_public: Option<bool>,
    #[allow(dead_code)]
    workflow_id: Option<i64>,
}

/// Set workflow visibility (public/private)
/// Only the owning organization can change visibility
/// workflow_id can be either numeric ID or UUID (github_folder)
pub async fn set_workflow_visibility(workflow_id: &str, is_public: bool) -> Result<bool, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!(
        "{}/api/remote-workflows/{}/visibility",
        api_base, workflow_id
    );

    info!(
        "🌐 Setting workflow {} visibility to {}",
        workflow_id,
        if is_public { "public" } else { "private" }
    );

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "is_public": is_public
        }))
        .send()
        .await
        .map_err(|e| format!("Network error setting visibility: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            "❌ Failed to set visibility for workflow {}: {} - {}",
            workflow_id, status, error_text
        );
        return Err(format!("Failed to set visibility: {}", error_text));
    }

    let result: VisibilityResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse visibility response: {}", e))?;

    if !result.success {
        return Err("API returned success=false".to_string());
    }

    let new_visibility = result.is_public.unwrap_or(is_public);
    info!(
        "✅ Workflow {} visibility set to {}",
        workflow_id,
        if new_visibility { "public" } else { "private" }
    );

    Ok(new_visibility)
}

/// Convert JSON automation_sequence to YAML string
/// Backend stores as JSON, but desktop app works with YAML
///
/// **DEPRECATED**: This function is for YAML workflows. TypeScript workflows
/// don't use this conversion.
pub fn json_to_yaml(json_value: &serde_json::Value) -> Result<String, String> {
    serde_yaml::to_string(json_value).map_err(|e| format!("Failed to convert JSON to YAML: {}", e))
}

/// Parse YAML string to JSON value for validation
///
/// **DEPRECATED**: This function is for YAML workflows. TypeScript workflows
/// don't use this conversion.
pub fn yaml_to_json(yaml_content: &str) -> Result<serde_json::Value, String> {
    serde_yaml::from_str(yaml_content).map_err(|e| format!("Failed to parse YAML: {}", e))
}

/// List all organizations (admin only)
/// Returns list of orgs with workflow counts for the org switcher
pub async fn list_all_organizations() -> Result<ListOrgsResponse, String> {
    let token = get_auth_token().await?;
    let client = Client::new();
    let api_base = get_api_base();
    let url = format!("{}/api/admin/list-all-orgs", api_base);

    info!("📋 Fetching all organizations from: {}", url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error listing organizations: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());

        if status.as_u16() == 403 {
            // Not an admin - return empty list with isMediarAdmin = false
            return Ok(ListOrgsResponse {
                success: Some(false),
                organizations: vec![],
                total_organizations: Some(0),
                is_mediar_admin: false,
            });
        }

        error!(
            "❌ Failed to list organizations: {} - {}",
            status, error_text
        );
        return Err(format!("Failed to list organizations (status: {})", status));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let response_data: ListOrgsResponse =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse organizations response: {}", e))?;

    info!(
        "✅ Retrieved {} organizations",
        response_data.organizations.len()
    );
    Ok(response_data)
}
