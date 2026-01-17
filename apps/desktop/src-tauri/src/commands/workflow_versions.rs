use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use walkdir::WalkDir;

/// Represents a saved version/snapshot of a workflow (stored as JSON + file copies)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowVersion {
    pub id: String,
    pub workflow_id: String,
    pub version_number: u32,
    pub message: Option<String>,
    pub author_type: String, // "user" | "ai" | "auto"
    pub created_at: String,  // ISO timestamp
    pub changed_files: Vec<String>,
    pub diff_summary: Option<String>,
}

/// Result of listing workflow versions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListVersionsResult {
    pub versions: Vec<WorkflowVersion>,
    pub total_count: usize,
}

/// Result of restoring a version
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreVersionResult {
    pub success: bool,
    pub error: Option<String>,
    pub restored_files: Vec<String>,
}

/// Metadata stored in each version folder
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VersionMetadata {
    id: String,
    workflow_id: String,
    workflow_path: String, // Original workflow path for reference
    version_number: u32,
    message: Option<String>,
    author_type: String,
    created_at: String,
    changed_files: Vec<String>,
    diff_summary: Option<String>,
}

/// Get the central local history directory: ~/.mediar/local-history/{workflow-id}/
fn get_history_dir(workflow_id: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not find home directory".to_string())?;
    Ok(home.join(".mediar").join("local-history").join(workflow_id))
}

fn get_version_dir(workflow_id: &str, version_id: &str) -> Result<PathBuf, String> {
    Ok(get_history_dir(workflow_id)?.join(version_id))
}

/// Extract workflow ID from path (folder name, which is typically a UUID)
fn get_workflow_id_from_path(workflow_path: &str) -> String {
    PathBuf::from(workflow_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn get_files_to_version(workflow_path: &str) -> Vec<String> {
    let workflow_dir = PathBuf::from(workflow_path);
    let mut files = Vec::new();

    for entry in WalkDir::new(&workflow_dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            // Skip hidden folders (except .env files), but allow hidden files at root
            if e.depth() > 0 && name.starts_with('.') && name != ".env" && !name.starts_with(".env.") {
                return false;
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Ok(relative) = entry.path().strip_prefix(&workflow_dir) {
                let rel_str = relative.to_string_lossy().to_string();
                // Skip node_modules, .versions, .git, and executions directories
                if !rel_str.starts_with("node_modules")
                    && !rel_str.starts_with(".versions")
                    && !rel_str.starts_with(".git")
                    && !rel_str.starts_with("executions")
                    && !rel_str.contains("node_modules")
                    && !rel_str.contains("executions")
                {
                    files.push(rel_str);
                }
            }
        }
    }

    files
}

fn get_next_version_number(workflow_id: &str) -> u32 {
    let history_dir = match get_history_dir(workflow_id) {
        Ok(dir) => dir,
        Err(_) => return 1,
    };

    if !history_dir.exists() {
        return 1;
    }

    let mut max_version = 0u32;
    if let Ok(entries) = fs::read_dir(&history_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let metadata_path = entry.path().join("metadata.json");
            if let Ok(content) = fs::read_to_string(&metadata_path) {
                if let Ok(metadata) = serde_json::from_str::<VersionMetadata>(&content) {
                    max_version = max_version.max(metadata.version_number);
                }
            }
        }
    }

    max_version + 1
}

#[tauri::command]
#[specta::specta]
pub async fn save_workflow_version(
    workflow_path: String,
    message: Option<String>,
    author_type: String,
) -> Result<WorkflowVersion, String> {
    let workflow_dir = PathBuf::from(&workflow_path);
    if !workflow_dir.exists() {
        return Err(format!("Workflow path does not exist: {}", workflow_path));
    }

    let workflow_id = get_workflow_id_from_path(&workflow_path);

    // Create history directory in ~/.mediar/local-history/{workflow-id}/
    let history_dir = get_history_dir(&workflow_id)?;
    fs::create_dir_all(&history_dir)
        .map_err(|e| format!("Failed to create history directory: {}", e))?;

    // Generate version info
    let version_id = Uuid::new_v4().to_string();
    let version_number = get_next_version_number(&workflow_id);
    let created_at: DateTime<Utc> = Utc::now();

    // Create version directory
    let version_dir = get_version_dir(&workflow_id, &version_id)?;
    fs::create_dir_all(&version_dir)
        .map_err(|e| format!("Failed to create version directory: {}", e))?;

    // Get files to snapshot
    let files_to_copy = get_files_to_version(&workflow_path);
    let mut changed_files = Vec::new();

    // Copy all workflow files to version directory
    for file in &files_to_copy {
        let src = workflow_dir.join(file);
        let dst = version_dir.join(file);

        // Create parent directories
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for {}: {}", file, e))?;
        }

        // Copy file
        if src.exists() {
            fs::copy(&src, &dst)
                .map_err(|e| format!("Failed to copy file {}: {}", file, e))?;
            changed_files.push(file.clone());
        }
    }

    // Save metadata
    let metadata = VersionMetadata {
        id: version_id.clone(),
        workflow_id: workflow_id.clone(),
        workflow_path: workflow_path.clone(),
        version_number,
        message: message.clone(),
        author_type: author_type.clone(),
        created_at: created_at.to_rfc3339(),
        changed_files: changed_files.clone(),
        diff_summary: None,
    };

    let metadata_path = version_dir.join("metadata.json");
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
    fs::write(&metadata_path, metadata_json)
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    tracing::info!(
        "[LOCAL_HISTORY] Saved version {} (v{}) for workflow {} - {} files",
        version_id,
        version_number,
        workflow_id,
        changed_files.len()
    );

    Ok(WorkflowVersion {
        id: version_id,
        workflow_id,
        version_number,
        message,
        author_type,
        created_at: created_at.to_rfc3339(),
        changed_files,
        diff_summary: None,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_workflow_versions(
    workflow_path: String,
) -> Result<ListVersionsResult, String> {
    let workflow_id = get_workflow_id_from_path(&workflow_path);
    let history_dir = get_history_dir(&workflow_id)?;

    if !history_dir.exists() {
        return Ok(ListVersionsResult {
            versions: Vec::new(),
            total_count: 0,
        });
    }

    let mut versions = Vec::new();

    if let Ok(entries) = fs::read_dir(&history_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let metadata_path = entry.path().join("metadata.json");
            if let Ok(content) = fs::read_to_string(&metadata_path) {
                if let Ok(metadata) = serde_json::from_str::<VersionMetadata>(&content) {
                    versions.push(WorkflowVersion {
                        id: metadata.id,
                        workflow_id: metadata.workflow_id,
                        version_number: metadata.version_number,
                        message: metadata.message,
                        author_type: metadata.author_type,
                        created_at: metadata.created_at,
                        changed_files: metadata.changed_files,
                        diff_summary: metadata.diff_summary,
                    });
                }
            }
        }
    }

    // Sort by version number descending (newest first)
    versions.sort_by(|a, b| b.version_number.cmp(&a.version_number));

    let total_count = versions.len();

    Ok(ListVersionsResult {
        versions,
        total_count,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn restore_workflow_version(
    workflow_path: String,
    version_id: String,
) -> Result<RestoreVersionResult, String> {
    let workflow_dir = PathBuf::from(&workflow_path);
    let workflow_id = get_workflow_id_from_path(&workflow_path);
    let version_dir = get_version_dir(&workflow_id, &version_id)?;

    if !version_dir.exists() {
        return Ok(RestoreVersionResult {
            success: false,
            error: Some(format!("Version {} not found", version_id)),
            restored_files: Vec::new(),
        });
    }

    // Read version metadata
    let metadata_path = version_dir.join("metadata.json");
    let metadata: VersionMetadata = fs::read_to_string(&metadata_path)
        .map_err(|e| format!("Failed to read version metadata: {}", e))
        .and_then(|content| {
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse version metadata: {}", e))
        })?;

    let mut restored_files = Vec::new();

    // Restore each file from the version
    for file in &metadata.changed_files {
        let src = version_dir.join(file);
        let dst = workflow_dir.join(file);

        if src.exists() {
            // Create parent directories if needed
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory for {}: {}", file, e))?;
            }

            // Copy file back
            fs::copy(&src, &dst)
                .map_err(|e| format!("Failed to restore file {}: {}", file, e))?;
            restored_files.push(file.clone());
        }
    }

    tracing::info!(
        "[LOCAL_HISTORY] Restored version {} ({} files)",
        version_id,
        restored_files.len()
    );

    Ok(RestoreVersionResult {
        success: true,
        error: None,
        restored_files,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_workflow_version(
    workflow_path: String,
    version_id: String,
) -> Result<(), String> {
    let workflow_id = get_workflow_id_from_path(&workflow_path);
    let version_dir = get_version_dir(&workflow_id, &version_id)?;

    if !version_dir.exists() {
        return Err(format!("Version {} not found", version_id));
    }

    fs::remove_dir_all(&version_dir)
        .map_err(|e| format!("Failed to delete version: {}", e))?;

    tracing::info!("[LOCAL_HISTORY] Deleted version {}", version_id);

    Ok(())
}
