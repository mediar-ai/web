//! # Workflow Commands (Cloud YAML Workflows)
//!
//! **DEPRECATION NOTICE**: These commands are for cloud YAML workflows which are being phased out.
//! TypeScript workflows are now the primary workflow format.
//!
//! ## Deprecated Commands (YAML-specific):
//! - `get_current_workflow` - Gets YAML content from cloud
//! - `save_workflow` - Saves YAML content to cloud
//! - `create_workflow` - Creates new YAML workflow
//! - `export_workflow` - Exports YAML content
//! - `import_workflow` - Imports YAML content
//!
//! ## Still Used Commands:
//! - `list_saved_workflows` - Lists all workflows (filters to TypeScript on frontend)
//! - `delete_saved_workflow` - Deletes any workflow
//! - `rename_workflow` - Renames any workflow
//! - `revert_workflow_version` - Reverts to previous version
//! - `clone_workflow` - Clones a workflow
//!
//! For TypeScript workflows, see `commands/workflows.rs` which uses String UUIDs.

use crate::load_settings;
use crate::workflow_api_client::{
    self, create_workflow as api_create_workflow, delete_latest_workflow_version as api_delete_latest_workflow_version,
    delete_workflow as api_delete_workflow, duplicate_workflow as api_duplicate_workflow,
    get_workflow as api_get_workflow, list_all_organizations as api_list_all_organizations,
    list_workflows as api_list_workflows, set_workflow_visibility as api_set_workflow_visibility,
    update_workflow_content as api_update_workflow_content, update_workflow_metadata as api_update_workflow_metadata,
    update_workflow_tags as api_update_workflow_tags, ListOrgsResponse, WorkflowSummary,
};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::command;

/// Workflow data returned to frontend
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowData {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub yaml_content: String,
    pub step_count: i32,
    pub created_at: String,
    pub updated_at: String,
    // Permission/Ownership fields for frontend authorization
    pub created_by: Option<String>,
    pub organization_id: Option<String>,
    pub is_public: Option<bool>,
}

/// Retry an async operation once on failure
async fn with_retry<T, F, Fut>(operation: F) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    match operation().await {
        Ok(result) => Ok(result),
        Err(first_error) => {
            warn!("⚠️ First attempt failed: {}, retrying...", first_error);

            // Wait a bit before retry
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            match operation().await {
                Ok(result) => {
                    info!("✅ Retry successful");
                    Ok(result)
                }
                Err(second_error) => {
                    error!("❌ Retry failed: {}", second_error);
                    Err(format!("Network error after retry: {}", second_error))
                }
            }
        }
    }
}

/// Get a workflow by ID
///
/// **DEPRECATED**: This command is for YAML workflows. TypeScript workflows use
/// `read_typescript_workflow_files` instead.
#[command]
pub async fn get_current_workflow(workflow_id: i64) -> Result<WorkflowData, String> {
    info!("📄 Getting workflow ID: {}", workflow_id);

    let workflow = with_retry(|| api_get_workflow(workflow_id)).await?;

    // Get YAML content (prefer YAML, fallback to converting JSON)
    let yaml_content = if let Some(yaml) = workflow.automation_sequence_yaml.clone() {
        yaml
    } else if let Some(json) = workflow.automation_sequence {
        workflow_api_client::json_to_yaml(&json)?
    } else {
        return Err("Workflow has no content".to_string());
    };

    // Count steps
    let step_count = yaml_content.matches("tool_name:").count() as i32;

    Ok(WorkflowData {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description.unwrap_or_default(),
        yaml_content,
        step_count,
        created_at: workflow.created_at.unwrap_or_default(),
        updated_at: workflow.updated_at.unwrap_or_default(),
        created_by: workflow.created_by,
        organization_id: workflow.organization_id,
        is_public: workflow.is_public,
    })
}

/// Save workflow content (update existing)
///
/// **DEPRECATED**: This command is for YAML workflows. TypeScript workflows use
/// `write_typescript_workflow_file` instead.
#[command]
pub async fn save_workflow(workflow_id: i64, content: String) -> Result<(), String> {
    info!("💾 Saving workflow ID: {}", workflow_id);

    with_retry(|| api_update_workflow_content(workflow_id, content.clone())).await?;

    info!("✅ Workflow {} saved successfully", workflow_id);
    Ok(())
}

/// List all workflows (returns structured data for UI)
#[command]
pub async fn list_saved_workflows() -> Result<Vec<WorkflowSummary>, String> {
    info!("📋 Listing all workflows");

    // Get view_org_id from settings for admin org switching
    let view_org_id = match load_settings().await {
        Ok(settings) => settings.view_org_id,
        Err(e) => {
            warn!(
                "Failed to load settings for view_org_id: {}, using default",
                e
            );
            None
        }
    };

    if view_org_id.is_some() {
        info!("🔍 Using view_org_id: {:?}", view_org_id);
    }

    let workflows = with_retry(|| api_list_workflows(view_org_id.clone())).await?;

    info!("✅ Retrieved {} workflows", workflows.len());
    if !workflows.is_empty() {
        info!(
            "🔍 [DEBUG] First workflow version data: current_version={:?}, total_versions={:?}",
            workflows[0].current_version, workflows[0].total_versions
        );
    }
    Ok(workflows)
}

/// List all community/public workflows
/// Returns workflows that are marked as is_public = true
/// These are shown separately from the user's own workflows
/// If view_org_id is "ALL" (admin only), returns all workflows instead of just public ones
#[command]
pub async fn list_community_workflows() -> Result<Vec<WorkflowSummary>, String> {
    use crate::workflow_api_client::list_community_workflows as api_list_community_workflows;

    info!("🌐 Listing community workflows");

    // Get view_org_id from settings for admin org switching
    let view_org_id = match load_settings().await {
        Ok(settings) => settings.view_org_id,
        Err(e) => {
            warn!(
                "Failed to load settings for view_org_id: {}, using default",
                e
            );
            None
        }
    };

    if view_org_id.is_some() {
        info!("🔍 Using view_org_id for community: {:?}", view_org_id);
    }

    let workflows = with_retry(|| api_list_community_workflows(view_org_id.clone())).await?;

    info!("✅ Retrieved {} community workflows", workflows.len());
    Ok(workflows)
}

/// List all organizations (admin only)
#[command]
pub async fn list_all_organizations() -> Result<ListOrgsResponse, String> {
    info!("📋 Listing all organizations");

    let response = api_list_all_organizations().await?;

    info!(
        "✅ Retrieved {} organizations, isMediarAdmin: {}",
        response.organizations.len(),
        response.is_mediar_admin
    );
    Ok(response)
}

/// Create a new workflow
///
/// **DEPRECATED**: This command is for YAML workflows. TypeScript workflows use
/// `create_typescript_workflow` instead.
#[command]
pub async fn create_workflow(workflow_name: String, initial_content: Option<String>) -> Result<i64, String> {
    let content = initial_content.unwrap_or_else(|| {
        format!(
            "# Workflow: {}\n# Created: {}\n\nsteps: []\n",
            workflow_name,
            chrono::Utc::now().to_rfc3339()
        )
    });

    info!("📝 Creating workflow: {}", workflow_name);

    let workflow = with_retry(|| api_create_workflow(workflow_name.clone(), None, content.clone())).await?;

    info!(
        "✅ Created workflow '{}' with ID: {}",
        workflow_name, workflow.id
    );
    Ok(workflow.id)
}

/// Delete a workflow
#[command]
pub async fn delete_saved_workflow(workflow_id: i64) -> Result<(), String> {
    info!("🗑️ Deleting workflow ID: {}", workflow_id);

    with_retry(|| api_delete_workflow(workflow_id)).await?;

    info!("✅ Deleted workflow {}", workflow_id);
    Ok(())
}

/// Rename a workflow
#[command]
pub async fn rename_workflow(workflow_id: i64, new_name: String) -> Result<(), String> {
    info!("✏️ Renaming workflow {} to: {}", workflow_id, new_name);

    with_retry(|| api_update_workflow_metadata(workflow_id, Some(new_name.clone()), None)).await?;

    info!("✅ Renamed workflow {}", workflow_id);
    Ok(())
}

/// Update workflow tags
#[command]
pub async fn update_workflow_tags(workflow_id: i64, tags: Vec<String>) -> Result<(), String> {
    info!("🏷️ Updating workflow {} tags to: {:?}", workflow_id, tags);

    with_retry(|| api_update_workflow_tags(workflow_id, tags.clone())).await?;

    info!("✅ Updated workflow {} tags", workflow_id);
    Ok(())
}

/// Export workflow (get content for export)
///
/// **DEPRECATED**: This command is for YAML workflows. TypeScript workflows are
/// exported via file system access.
#[command]
pub async fn export_workflow(workflow_id: i64) -> Result<String, String> {
    info!("📤 Exporting workflow ID: {}", workflow_id);

    let workflow_data = get_current_workflow(workflow_id).await?;

    Ok(workflow_data.yaml_content)
}

/// Import workflow (create from content)
///
/// **DEPRECATED**: This command is for YAML workflows. TypeScript workflows use
/// `create_typescript_workflow` instead.
#[command]
pub async fn import_workflow(workflow_name: String, content: String) -> Result<i64, String> {
    info!("📥 Importing workflow as: {}", workflow_name);

    let workflow_id = create_workflow(workflow_name.clone(), Some(content)).await?;

    info!(
        "✅ Imported workflow '{}' with ID: {}",
        workflow_name, workflow_id
    );
    Ok(workflow_id)
}

/// Revert to previous workflow version by deleting the latest version
#[command]
pub async fn revert_workflow_version(workflow_id: i64) -> Result<(), String> {
    info!("⏪ Reverting workflow {} to previous version", workflow_id);

    with_retry(|| api_delete_latest_workflow_version(workflow_id)).await?;

    info!("✅ Workflow {} reverted to previous version", workflow_id);
    Ok(())
}

/// Clone an existing workflow
/// workflow_id can be either numeric ID or UUID (github_folder for TypeScript workflows)
#[command]
pub async fn clone_workflow(workflow_id: String, workflow_name: String) -> Result<i64, String> {
    info!(
        "🔄 [CLONE] Cloning workflow '{}' (ID: {})",
        workflow_name, workflow_id
    );

    // Call duplicate API with the workflow name (backend will add CLONED prefix)
    let cloned_workflow = with_retry(|| api_duplicate_workflow(&workflow_id, workflow_name.clone())).await?;

    info!(
        "✅ [CLONE] Cloned workflow '{}' with new ID: {}",
        workflow_name, cloned_workflow.id
    );
    Ok(cloned_workflow.id)
}

/// Set workflow visibility (public/private)
/// Returns the new visibility state
/// workflow_id can be either numeric ID or UUID (github_folder)
#[command]
pub async fn set_workflow_visibility(workflow_id: String, is_public: bool) -> Result<bool, String> {
    info!(
        "🌐 Setting workflow {} visibility to {}",
        workflow_id,
        if is_public { "public" } else { "private" }
    );

    let result = api_set_workflow_visibility(&workflow_id, is_public).await?;

    info!(
        "✅ Workflow {} is now {}",
        workflow_id,
        if result { "public" } else { "private" }
    );

    Ok(result)
}
