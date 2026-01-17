use chrono::Utc;
use notify::RecursiveMode;
use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

use crate::edit_history::{EditHistory, RestoreResult, RestoredFile};

// Global storage for file watchers keyed by workflow_id
static WORKFLOW_WATCHERS: Lazy<Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Global storage for edit histories keyed by workflow_id
static EDIT_HISTORIES: Lazy<Mutex<HashMap<String, EditHistory>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Paths to skip in file watcher (set before undo/redo writes, cleared after)
static SKIP_WATCHER_PATHS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// Compare two semver version strings (e.g., "1.0.97" vs "1.0.99")
/// Returns Ordering::Greater if v1 > v2, Ordering::Less if v1 < v2, Ordering::Equal if same
fn compare_versions(v1: &str, v2: &str) -> std::cmp::Ordering {
    let parse_version = |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse::<u32>().ok()).collect() };

    let parts1 = parse_version(v1);
    let parts2 = parse_version(v2);

    // Compare each component
    for i in 0..std::cmp::max(parts1.len(), parts2.len()) {
        let p1 = parts1.get(i).copied().unwrap_or(0);
        let p2 = parts2.get(i).copied().unwrap_or(0);
        match p1.cmp(&p2) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// Create a Command that hides the console window on Windows
/// This prevents CLI windows from flashing during background operations
fn create_hidden_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

/// Create a directory and optionally hide it on Windows
/// On Windows, sets FILE_ATTRIBUTE_HIDDEN on the directory
/// On other platforms, just creates the directory (dot-prefix already hides it)
fn create_hidden_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

        // Check if already hidden
        if let Ok(metadata) = std::fs::metadata(path) {
            if metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return Ok(()); // Already hidden
            }
        }

        // Set hidden attribute
        let wide_path: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            extern "system" {
                fn SetFileAttributesW(lpFileName: *const u16, dwFileAttributes: u32) -> i32;
            }

            if SetFileAttributesW(wide_path.as_ptr(), FILE_ATTRIBUTE_HIDDEN) == 0 {
                // Log warning but don't fail - hiding is optional
                log::warn!(
                    "⚠️ Failed to set hidden attribute on {}: {}",
                    path.display(),
                    std::io::Error::last_os_error()
                );
            } else {
                log::debug!("🙈 Set hidden attribute on {}", path.display());
            }
        }
    }

    Ok(())
}

/// Create an initial state.json file for a workflow
/// This is called when creating new workflows or when loading workflows that don't have state.json
fn create_initial_state_file(workflow_path: &Path, workflow_id: &str) -> std::io::Result<()> {
    let state_file = workflow_path.join("state.json");

    // Don't overwrite if already exists
    if state_file.exists() {
        return Ok(());
    }

    let initial_state = serde_json::json!({
        "last_updated": Utc::now().to_rfc3339(),
        "last_step_id": null,
        "last_step_index": 0,
        "workflow_id": workflow_id,
        "workflow_file": null,
        "env": {}
    });

    fs::write(
        &state_file,
        serde_json::to_string_pretty(&initial_state).unwrap_or_default(),
    )?;

    info!(
        "📄 Created initial state.json for workflow: {}",
        workflow_id
    );
    Ok(())
}

/// Find the bundled bun executable next to the app binary
/// Returns the path to bun.exe if found, None otherwise
pub fn find_bundled_bun() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    let exe_dir = exe_path.parent()?;

    // Check for bun.exe in the same directory as the app
    let bun_path = exe_dir.join("bun.exe");
    if bun_path.exists() && bun_path.is_file() {
        info!("Found bundled bun at: {}", bun_path.display());
        return Some(bun_path);
    }

    None
}

/// Find workflow folder path by UUID
/// Scans all workflow folders to find the one with matching cloud_workflow_uuid in sync.json
/// Returns the full path to the workflow folder if found
fn find_workflow_path_by_uuid(workflows_dir: &Path, uuid: &str) -> Option<PathBuf> {
    // sync.json is the source of truth for workflow identity - check it FIRST
    if let Ok(entries) = fs::read_dir(workflows_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let sync_file = path.join(".mediar").join("sync.json");
            if let Ok(content) = fs::read_to_string(&sync_file) {
                if let Ok(sync_data) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(stored_uuid) = sync_data
                        .get("cloud_workflow_uuid")
                        .and_then(|v| v.as_str())
                    {
                        if stored_uuid == uuid {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }

    // Fallback: check if folder with UUID name exists (legacy support only)
    let direct_path = workflows_dir.join(uuid);
    if direct_path.exists() && direct_path.is_dir() {
        return Some(direct_path);
    }

    None
}

#[derive(Debug, Serialize, specta::Type)]
pub struct SearchMatch {
    pub line_number: usize,
    pub content: String,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub total_matches: usize,
    pub workflow_id: String,
}

/// Information about a local TypeScript workflow
#[derive(Debug, Serialize, specta::Type)]
pub struct LocalTypescriptWorkflow {
    /// Folder name - used for local file operations via Tauri commands
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub path: String,
    pub created_at: String,
    pub modified_at: String,
    /// Cloud UUID (github_folder) - used for cloud sync operations like chat sessions
    /// This may differ from `id` for legacy workflows with human-readable folder names
    /// If None, workflow hasn't been synced to cloud yet
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cloud_id: Option<String>,
}

/// File content for reading workflow files
#[derive(Debug, Serialize, specta::Type)]
pub struct WorkflowFileContent {
    pub path: String,
    pub content: String,
    pub is_step: bool,
}

/// File tree node for IDE-style file browsing
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String, // Relative path from workflow root
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}

/// Result of reading workflow file tree
#[derive(Debug, Serialize, specta::Type)]
pub struct WorkflowFileTreeResult {
    pub workflow_id: String,
    pub root: Vec<FileTreeNode>,
}

/// Result of reading a single workflow file
#[derive(Debug, Serialize, specta::Type)]
pub struct WorkflowFileContentResult {
    pub path: String,
    pub content: String,
    pub is_binary: bool,
    pub mime_type: Option<String>,
}

/// Result of reading a TypeScript workflow
#[derive(Debug, Serialize, specta::Type)]
pub struct ReadTypescriptWorkflowResult {
    pub id: String,
    pub terminator_ts: String,
    pub steps: Vec<WorkflowFileContent>,
    pub package_json: String,
}

/// Input for writing a TypeScript workflow file
#[derive(Debug, Deserialize, specta::Type)]
pub struct WriteTypescriptWorkflowFileInput {
    pub workflow_id: String,
    pub file_path: String,
    pub content: String,
}

/// Result of writing a TypeScript workflow file
#[derive(Debug, Serialize, specta::Type)]
pub struct WriteTypescriptWorkflowFileResult {
    pub success: bool,
    pub path: String,
}

/// Input for publishing a TypeScript workflow to cloud
#[derive(Debug, Deserialize, specta::Type)]
pub struct PublishTypescriptWorkflowInput {
    pub workflow_id: String, // UUID folder name
    pub name: String,
    pub description: Option<String>,
}

/// Result of publishing a TypeScript workflow
#[derive(Debug, Serialize, specta::Type)]
pub struct PublishTypescriptWorkflowResult {
    pub success: bool,
    pub cloud_workflow_id: i64,
    pub version: String,
    pub step_count: usize,
}

/// File for publishing to cloud
#[derive(Debug, Serialize)]
struct PublishFile {
    path: String,
    content: String,
}

/// Sync metadata stored locally after publish
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct SyncMetadata {
    pub last_synced_at: Option<String>,
    pub cloud_workflow_id: Option<i64>,
    pub cloud_version: Option<String>,
    /// UUID used as github_folder in cloud database
    /// This is the folder name for new workflows, but may differ for legacy workflows
    #[serde(default)]
    pub cloud_workflow_uuid: Option<String>,
}

/// Result of checking remote workflow status
#[derive(Debug, Serialize, specta::Type)]
pub struct RemoteSyncStatus {
    pub has_remote: bool,
    pub remote_updated_at: Option<String>,
    pub local_synced_at: Option<String>,
    pub needs_pull: bool, // Remote has newer version than local sync
    pub remote_version: Option<String>,
    pub local_version: Option<String>,
    /// True if current user owns this workflow (can push changes)
    /// False if workflow exists in cloud but belongs to another user
    #[serde(default = "default_is_owner")]
    pub is_owner: bool,
}

fn default_is_owner() -> bool {
    true
}

/// Result of downloading a workflow from cloud
#[derive(Debug, Serialize, specta::Type)]
pub struct DownloadWorkflowResult {
    pub success: bool,
    pub workflow_id: String, // UUID folder name
    pub name: String,
    pub path: String,
}

use log::{debug, error, info, warn};
use std::env;
use std::fs;
use std::path::PathBuf;

// REMOVED: WorkflowFileInfo and ListWorkflowsResult - No longer needed with cloud storage

/// Result of dependency installation with detailed error info
#[derive(Debug)]
pub struct DependencyInstallResult {
    pub success: bool,
    pub error_message: Option<String>,
    pub is_cache_error: bool,
}

/// Clear the bun package cache
/// Returns Ok(message) on success, Err(message) on failure
fn clear_bun_cache() -> Result<String, String> {
    info!("🧹 Clearing bun package cache...");

    // Use bundled bun if available, otherwise try system PATH
    let bun_cmd = find_bundled_bun()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "bun".to_string());

    // First try: bun pm cache rm
    match create_hidden_command(&bun_cmd)
        .args(["pm", "cache", "rm"])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                info!("✅ Bun cache cleared successfully via 'bun pm cache rm'");
                return Ok("Bun package cache cleared successfully".to_string());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("⚠️ 'bun pm cache rm' failed: {}", stderr);
        }
        Err(e) => {
            warn!("⚠️ Failed to run 'bun pm cache rm': {}", e);
        }
    }

    // Fallback: manually delete the cache directory
    let cache_dir = if cfg!(target_os = "windows") {
        let home = env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".bun")
            .join("install")
            .join("cache")
    } else {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".bun")
            .join("install")
            .join("cache")
    };

    if cache_dir.exists() {
        info!("📁 Manually removing bun cache directory: {:?}", cache_dir);
        match fs::remove_dir_all(&cache_dir) {
            Ok(_) => {
                info!("✅ Bun cache directory deleted successfully");
                Ok("Bun package cache cleared successfully (manual deletion)".to_string())
            }
            Err(e) => {
                error!("❌ Failed to delete bun cache directory: {}", e);
                Err(format!("Failed to clear bun cache: {}", e))
            }
        }
    } else {
        info!("ℹ️ Bun cache directory does not exist, nothing to clear");
        Ok("Bun cache directory does not exist (already clean)".to_string())
    }
}

/// Install dependencies for a TypeScript workflow (reusable helper)
/// Returns DependencyInstallResult with detailed error info
fn install_workflow_dependencies_internal(workflow_path: &Path) -> DependencyInstallResult {
    let package_json_path = workflow_path.join("package.json");
    if !package_json_path.exists() {
        info!("📦 No package.json found, skipping dependency installation");
        return DependencyInstallResult {
            success: true,
            error_message: None,
            is_cache_error: false,
        };
    }

    info!("📦 Installing dependencies for workflow...");

    // Detect runtime: prefer bundled bun, then system bun, fallback to npm
    let (runtime_name, runtime_path) = if let Some(bundled_bun) = find_bundled_bun() {
        // Use bundled bun
        let path_str = bundled_bun.to_string_lossy().to_string();
        ("bun (bundled)", path_str)
    } else if create_hidden_command("bun")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        // Use system bun from PATH
        ("bun (system)", "bun".to_string())
    } else {
        // Fallback to npm
        ("npm", "npm".to_string())
    };

    info!("Using {} runtime for dependency installation", runtime_name);

    // Step 1: Run install to ensure all deps are present
    match create_hidden_command(&runtime_path)
        .arg("install")
        .current_dir(workflow_path)
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let is_cache_error = stderr.contains("ENOENT: failed opening cache/package/version dir");
                warn!("⚠️ Dependency installation failed: {}", stderr);
                return DependencyInstallResult {
                    success: false,
                    error_message: Some(stderr),
                    is_cache_error,
                };
            }
            info!("✅ Dependencies installed successfully");
        }
        Err(e) => {
            let error_msg = format!("Failed to run {} install: {}", runtime_name, e);
            warn!("⚠️ {}", error_msg);
            return DependencyInstallResult {
                success: false,
                error_message: Some(error_msg),
                is_cache_error: false,
            };
        }
    }

    // Step 2: Update @mediar-ai/workflow to latest (package.json says "latest" but lockfile pins it)
    info!("📦 Updating @mediar-ai/workflow to latest...");
    let update_args = if runtime_name.contains("bun") {
        vec!["update", "@mediar-ai/workflow"]
    } else {
        // npm uses different syntax
        vec!["update", "@mediar-ai/workflow"]
    };

    match create_hidden_command(&runtime_path)
        .args(&update_args)
        .current_dir(workflow_path)
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                info!("✅ @mediar-ai/workflow updated to latest");
            } else {
                // Non-fatal: workflow can still run with older version
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                warn!(
                    "⚠️ Failed to update @mediar-ai/workflow (non-fatal): {}",
                    stderr
                );
            }
        }
        Err(e) => {
            // Non-fatal: workflow can still run with older version
            warn!("⚠️ Failed to update @mediar-ai/workflow (non-fatal): {}", e);
        }
    }

    DependencyInstallResult {
        success: true,
        error_message: None,
        is_cache_error: false,
    }
}

/// Sanitize package.json to replace file: protocol dependencies with npm versions
/// This is needed because workflows downloaded from cloud may contain
/// hardcoded local file paths from the original developer's machine (e.g., file:C:/Users/matt/...)
fn sanitize_package_json_dependencies(workflow_path: &Path) {
    let package_json_path = workflow_path.join("package.json");
    if !package_json_path.exists() {
        return;
    }

    let content = match fs::read_to_string(&package_json_path) {
        Ok(c) => c,
        Err(e) => {
            warn!("⚠️ Failed to read package.json for sanitization: {}", e);
            return;
        }
    };

    let mut package_json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            warn!("⚠️ Failed to parse package.json for sanitization: {}", e);
            return;
        }
    };

    let mut modified = false;

    // Check and fix dependencies
    if let Some(deps) = package_json.get_mut("dependencies") {
        if let Some(deps_obj) = deps.as_object_mut() {
            for (name, version) in deps_obj.iter_mut() {
                if let Some(version_str) = version.as_str() {
                    // Replace file: protocol dependencies with "latest"
                    if version_str.starts_with("file:") {
                        info!(
                            "🔧 Replacing file: dependency {} = {} with \"latest\"",
                            name, version_str
                        );
                        *version = serde_json::Value::String("latest".to_string());
                        modified = true;
                    }
                }
            }
        }
    }

    // Check and fix devDependencies too
    if let Some(deps) = package_json.get_mut("devDependencies") {
        if let Some(deps_obj) = deps.as_object_mut() {
            for (name, version) in deps_obj.iter_mut() {
                if let Some(version_str) = version.as_str() {
                    if version_str.starts_with("file:") {
                        info!(
                            "🔧 Replacing file: devDependency {} = {} with \"latest\"",
                            name, version_str
                        );
                        *version = serde_json::Value::String("latest".to_string());
                        modified = true;
                    }
                }
            }
        }
    }

    if modified {
        // Also delete bun.lockb and node_modules to force fresh install
        let lockfile = workflow_path.join("bun.lockb");
        if lockfile.exists() {
            if let Err(e) = fs::remove_file(&lockfile) {
                warn!("⚠️ Failed to delete bun.lockb after sanitization: {}", e);
            } else {
                info!("✅ Deleted bun.lockb to force fresh install");
            }
        }

        let node_modules = workflow_path.join("node_modules");
        if node_modules.exists() {
            if let Err(e) = fs::remove_dir_all(&node_modules) {
                warn!("⚠️ Failed to delete node_modules after sanitization: {}", e);
            } else {
                info!("✅ Deleted node_modules to force fresh install");
            }
        }

        // Write the sanitized package.json
        match serde_json::to_string_pretty(&package_json) {
            Ok(new_content) => {
                if let Err(e) = fs::write(&package_json_path, new_content) {
                    warn!("⚠️ Failed to write sanitized package.json: {}", e);
                } else {
                    info!("✅ Sanitized package.json - replaced file: dependencies with npm versions");
                }
            }
            Err(e) => {
                warn!("⚠️ Failed to serialize sanitized package.json: {}", e);
            }
        }
    }
}

/// Set name field in package.json for proper display in UI
fn set_package_json_name(workflow_path: &Path, name: &str) {
    let package_json_path = workflow_path.join("package.json");
    if !package_json_path.exists() {
        return;
    }

    let content = match fs::read_to_string(&package_json_path) {
        Ok(c) => c,
        Err(e) => {
            warn!("[pkg] Failed to read package.json: {}", e);
            return;
        }
    };

    let mut package_json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            warn!("[pkg] Failed to parse package.json: {}", e);
            return;
        }
    };

    if let Some(obj) = package_json.as_object_mut() {
        obj.insert(
            "name".to_string(),
            serde_json::Value::String(name.to_string()),
        );
    }

    match serde_json::to_string_pretty(&package_json) {
        Ok(new_content) => {
            if let Err(e) = fs::write(&package_json_path, new_content) {
                warn!("[pkg] Failed to write package.json: {}", e);
            } else {
                info!("[pkg] Set name in package.json: {}", name);
            }
        }
        Err(e) => {
            warn!("[pkg] Failed to serialize package.json: {}", e);
        }
    }
}

/// Clear a single workflow's node_modules and lockfile to force reinstall
fn clear_single_workflow_cache(workflow_path: &Path) {
    // Delete node_modules
    let node_modules = workflow_path.join("node_modules");
    if node_modules.exists() {
        info!("🗑️ Deleting node_modules in: {:?}", workflow_path);
        if let Err(e) = fs::remove_dir_all(&node_modules) {
            warn!("⚠️ Failed to delete node_modules: {}", e);
        } else {
            info!("✅ Deleted node_modules");
        }
    }

    // Delete bun.lockb to force fresh lockfile
    let lockfile = workflow_path.join("bun.lockb");
    if lockfile.exists() {
        if let Err(e) = fs::remove_file(&lockfile) {
            warn!("⚠️ Failed to delete bun.lockb: {}", e);
        } else {
            info!("✅ Deleted bun.lockb");
        }
    }
}

/// Install dependencies for a TypeScript workflow (reusable helper)
/// Returns true if installation succeeded or was skipped, false on failure
/// Auto-retries after clearing cache on ENOENT cache errors
fn install_workflow_dependencies(workflow_path: &Path) -> bool {
    let result = install_workflow_dependencies_internal(workflow_path);

    if result.success {
        return true;
    }

    // If it's a cache error, try to clear cache and retry once
    if result.is_cache_error {
        warn!("🔄 Detected bun cache corruption, attempting to clear cache and retry...");

        // IMPORTANT: Clear the workflow's local node_modules first!
        // This is essential because bun may think "lockfile is fresh" but node_modules is corrupted
        clear_single_workflow_cache(workflow_path);

        // Also clear global cache
        match clear_bun_cache() {
            Ok(msg) => {
                info!("✅ {}", msg);
            }
            Err(err) => {
                warn!("⚠️ Failed to clear global cache: {}", err);
                // Continue anyway - local cache was cleared
            }
        }

        info!("🔄 Retrying dependency installation after cache clear...");
        let retry_result = install_workflow_dependencies_internal(workflow_path);
        if retry_result.success {
            info!("✅ Dependencies installed successfully after cache clear");
            return true;
        } else {
            if let Some(err) = retry_result.error_message {
                warn!(
                    "⚠️ Dependency installation still failed after cache clear: {}",
                    err
                );
            }
        }
    }

    false
}

/// Helper function to get workflows directory (sync version for internal use)
pub(crate) fn get_workflows_directory_sync() -> Result<String, String> {
    let workflows_dir = if cfg!(target_os = "windows") {
        let local_app_data =
            env::var("LOCALAPPDATA").unwrap_or_else(|_| env::var("APPDATA").unwrap_or_else(|_| ".".to_string()));
        PathBuf::from(local_app_data)
            .join("mediar")
            .join("workflows")
    } else if cfg!(target_os = "macos") {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("mediar")
            .join("workflows")
    } else {
        // Linux
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("mediar")
            .join("workflows")
    };

    // Ensure the workflows directory exists
    if let Err(e) = fs::create_dir_all(&workflows_dir) {
        return Err(format!("Failed to create workflows directory: {e}"));
    }

    Ok(workflows_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_workflows_directory() -> Result<String, String> {
    let path_str = get_workflows_directory_sync()?;
    info!("Returning workflows directory: {path_str}");
    Ok(path_str)
}

/// Clear all workflow node_modules directories to force reinstall
/// Returns the number of workflows cleared
fn clear_workflow_node_modules() -> (usize, Vec<String>) {
    let mut cleared_count = 0;
    let mut errors = Vec::new();

    // Get workflows directory
    let workflows_dir = match get_workflows_directory_sync() {
        Ok(dir) => PathBuf::from(dir),
        Err(e) => {
            warn!("⚠️ Failed to get workflows directory: {}", e);
            return (0, vec![e]);
        }
    };

    info!(
        "🧹 Scanning for workflow node_modules in: {:?}",
        workflows_dir
    );

    // Iterate through all workflow directories
    if let Ok(entries) = fs::read_dir(&workflows_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check for node_modules
                let node_modules = path.join("node_modules");
                if node_modules.exists() {
                    info!("🗑️ Deleting node_modules in: {:?}", path);
                    match fs::remove_dir_all(&node_modules) {
                        Ok(_) => {
                            info!("✅ Deleted node_modules in: {:?}", path);
                            cleared_count += 1;
                        }
                        Err(e) => {
                            warn!("⚠️ Failed to delete node_modules in {:?}: {}", path, e);
                            errors.push(format!("{}: {}", path.display(), e));
                        }
                    }
                }

                // Also delete bun.lockb to force fresh lockfile
                let lockfile = path.join("bun.lockb");
                if lockfile.exists() {
                    match fs::remove_file(&lockfile) {
                        Ok(_) => {
                            info!("✅ Deleted bun.lockb in: {:?}", path);
                        }
                        Err(e) => {
                            warn!("⚠️ Failed to delete bun.lockb in {:?}: {}", path, e);
                        }
                    }
                }
            }
        }
    }

    (cleared_count, errors)
}

/// Clear the bun/npm package cache to fix corrupted package installations
/// This is useful when dependency installation fails with ENOENT cache errors
#[tauri::command]
#[specta::specta]
pub async fn clear_package_cache() -> Result<String, String> {
    info!("🧹 User requested package cache clear");

    // FIRST: Clear all workflow node_modules directories
    // This is the most important step - global cache clear is useless if node_modules is corrupted
    let (workflows_cleared, workflow_errors) = clear_workflow_node_modules();
    info!(
        "🗑️ Cleared node_modules from {} workflows",
        workflows_cleared
    );

    // Try bun cache
    let bun_result = clear_bun_cache();

    // Also try clearing npm cache as a bonus
    let mut npm_cmd = std::process::Command::new("npm");
    npm_cmd.args(["cache", "clean", "--force"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        npm_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let npm_result = match npm_cmd.output() {
        Ok(output) => {
            if output.status.success() {
                info!("✅ npm cache cleared successfully");
                Ok("npm cache cleared".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("⚠️ npm cache clean failed: {}", stderr);
                Err(format!("npm cache clean failed: {}", stderr))
            }
        }
        Err(e) => {
            // npm might not be installed, that's fine
            info!("ℹ️ npm not available or failed: {}", e);
            Err(format!("npm not available: {}", e))
        }
    };

    // Build result message
    let workflow_msg = if workflows_cleared > 0 {
        format!("Cleared {} workflow(s) node_modules. ", workflows_cleared)
    } else {
        String::new()
    };

    let workflow_error_msg = if !workflow_errors.is_empty() {
        format!(" (⚠️ {} errors)", workflow_errors.len())
    } else {
        String::new()
    };

    // Return success if at least workflow node_modules were cleared OR bun cache was cleared
    match bun_result {
        Ok(bun_msg) => {
            let npm_status = match npm_result {
                Ok(npm_msg) => format!(" + {}", npm_msg),
                Err(_) => String::new(),
            };
            Ok(format!(
                "{}{}{}{}",
                workflow_msg, bun_msg, npm_status, workflow_error_msg
            ))
        }
        Err(bun_err) => {
            if workflows_cleared > 0 {
                // Even if global cache clear failed, we successfully cleared workflow node_modules
                Ok(format!(
                    "{}Global cache clear failed but workflow dependencies will be reinstalled on next run{}",
                    workflow_msg, workflow_error_msg
                ))
            } else {
                // Check if npm succeeded
                match npm_result {
                    Ok(npm_msg) => Ok(format!("{}{}", workflow_msg, npm_msg)),
                    Err(_) => Err(format!("Failed to clear package cache: {}", bun_err)),
                }
            }
        }
    }
}

// REMOVED: delete_workflow (local file version) - No longer needed with cloud storage

// REMOVED: list_workflows - No longer needed with cloud storage

// REMOVED: read_workflow - No longer needed with cloud storage

// REMOVED: write_workflow - No longer needed with cloud storage
// REMOVED: list_all_workflows - No longer needed with cloud storage

#[tauri::command]
#[specta::specta]
pub async fn open_workflows_folder() -> Result<(), String> {
    // Get the workflows directory using the existing function
    let workflows_dir = get_workflows_directory_sync()?;

    info!("📂 Opening workflows folder: {workflows_dir}");

    // Open the folder in the system file explorer
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        match std::process::Command::new("explorer.exe")
            .arg(&workflows_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(_) => {
                info!("Successfully opened workflows folder in Explorer");
            }
            Err(e) => {
                error!("Failed to open workflows folder: {e}");
                return Err(format!("Failed to open workflows folder: {e}"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&workflows_dir)
            .spawn()
            .map_err(|e| format!("Failed to open workflows folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open first, then fallback to common file managers
        let file_managers = vec![
            "xdg-open", "nautilus", "dolphin", "thunar", "pcmanfm", "nemo",
        ];
        let mut opened = false;

        for fm in file_managers {
            if std::process::Command::new(fm)
                .arg(&workflows_dir)
                .spawn()
                .is_ok()
            {
                opened = true;
                break;
            }
        }

        if !opened {
            return Err("Failed to open workflows folder in file manager".to_string());
        }
    }

    Ok(())
}

/// Search workflow execution state for a pattern
/// Returns matching lines with context
#[tauri::command]
#[specta::specta]
pub async fn search_workflow_execution_state(
    workflow_id: String,
    pattern: String,
    context_lines: Option<usize>,
) -> Result<SearchResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let state_file = PathBuf::from(&workflows_dir)
        .join(&workflow_id)
        .join("state.json");

    if !state_file.exists() {
        return Err(format!(
            "No execution state found for workflow {}",
            workflow_id
        ));
    }

    // Read and pretty-print the state file
    let content = fs::read_to_string(&state_file).map_err(|e| format!("Failed to read state file: {e}"))?;

    // Parse and re-serialize with pretty printing for better line-based search
    let json_value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse state JSON: {e}"))?;

    let pretty_content =
        serde_json::to_string_pretty(&json_value).map_err(|e| format!("Failed to format state JSON: {e}"))?;

    let lines: Vec<&str> = pretty_content.lines().collect();
    let pattern_lower = pattern.to_lowercase();
    let context = context_lines.unwrap_or(3);

    let mut matches: Vec<SearchMatch> = Vec::new();
    let mut matched_line_numbers: std::collections::HashSet<usize> = std::collections::HashSet::new();

    // Find all matching line numbers
    for (i, line) in lines.iter().enumerate() {
        if line.to_lowercase().contains(&pattern_lower) {
            matched_line_numbers.insert(i);
        }
    }

    let total_matches = matched_line_numbers.len();

    // Collect lines with context, avoiding duplicates
    let mut included_lines: std::collections::HashSet<usize> = std::collections::HashSet::new();

    for &match_line in &matched_line_numbers {
        let start = match_line.saturating_sub(context);
        let end = (match_line + context + 1).min(lines.len());

        for line_num in start..end {
            if !included_lines.contains(&line_num) {
                included_lines.insert(line_num);
                let is_match = matched_line_numbers.contains(&line_num);
                let prefix = if is_match { ">>> " } else { "    " };
                matches.push(SearchMatch {
                    line_number: line_num + 1, // 1-indexed
                    content: format!("{}{}", prefix, lines[line_num]),
                });
            }
        }
    }

    // Sort by line number
    matches.sort_by_key(|m| m.line_number);

    info!(
        "Search '{}' in workflow {} state: {} matches found",
        pattern, workflow_id, total_matches
    );

    Ok(SearchResult {
        matches,
        total_matches,
        workflow_id,
    })
}

/// Get the workflow execution state (env variables, inputs, etc.)
/// Returns the full state.json content for a workflow
#[tauri::command]
#[specta::specta]
pub async fn get_workflow_execution_state(workflow_id: String) -> Result<Option<serde_json::Value>, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID (resolves to actual folder path)
    let workflow_path = match find_workflow_path_by_uuid(&workflows_path, &workflow_id) {
        Some(path) => path,
        None => {
            info!(
                "Workflow not found for UUID {}, no execution state",
                workflow_id
            );
            return Ok(None);
        }
    };

    let state_file = workflow_path.join("state.json");

    if !state_file.exists() {
        info!("No execution state found for workflow {}", workflow_id);
        return Ok(None);
    }

    let content = fs::read_to_string(&state_file).map_err(|e| format!("Failed to read state file: {e}"))?;

    let json_value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse state JSON: {e}"))?;

    info!("Loaded execution state for workflow {}", workflow_id);
    Ok(Some(json_value))
}

/// Reset the workflow execution state to initial values
/// Called when starting a workflow from the beginning (step 0)
#[tauri::command]
#[specta::specta]
pub async fn reset_workflow_state(workflow_id: String) -> Result<(), String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    let state_file = workflow_path.join("state.json");

    // Create fresh state
    let initial_state = serde_json::json!({
        "last_updated": Utc::now().to_rfc3339(),
        "last_step_id": null,
        "last_step_index": 0,
        "workflow_id": workflow_id,
        "workflow_file": null,
        "env": {}
    });

    fs::write(
        &state_file,
        serde_json::to_string_pretty(&initial_state).map_err(|e| format!("Failed to serialize state: {e}"))?,
    )
    .map_err(|e| format!("Failed to write state.json: {e}"))?;

    info!("🔄 Reset execution state for workflow {}", workflow_id);
    Ok(())
}

/// Clone result returned to frontend
#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct CloneTypescriptWorkflowResult {
    pub id: String,
    pub path: String,
    pub name: String,
}

/// Clone an existing local TypeScript workflow
/// Creates a copy with a new UUID and "CLONED " prefix on the name
#[tauri::command]
#[specta::specta]
pub async fn clone_typescript_workflow(workflow_id: String) -> Result<CloneTypescriptWorkflowResult, String> {
    info!(
        "🔄 [CLONE] Cloning local TypeScript workflow: {}",
        workflow_id
    );

    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find source workflow by UUID
    let source_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Source workflow not found: {}", workflow_id))?;

    // Generate a new UUID for the cloned workflow
    let new_workflow_id = uuid::Uuid::new_v4().to_string();
    let dest_path = PathBuf::from(&workflows_dir).join(&new_workflow_id);

    info!(
        "🔄 [CLONE] Source: {} -> Dest: {}",
        source_path.display(),
        dest_path.display()
    );

    // Create destination directory
    fs::create_dir_all(&dest_path).map_err(|e| format!("Failed to create clone directory: {e}"))?;

    // Copy all files recursively, excluding node_modules and bun.lock
    copy_dir_recursive(
        &source_path,
        &dest_path,
        &["node_modules", "bun.lock", ".git"],
    )?;

    // Read and update package.json with new name
    let package_json_path = dest_path.join("package.json");
    let original_name = if package_json_path.exists() {
        let content =
            fs::read_to_string(&package_json_path).map_err(|e| format!("Failed to read package.json: {e}"))?;
        let mut json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse package.json: {e}"))?;

        let original = json
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("workflow")
            .to_string();
        let new_name = format!("CLONED {}", original);
        json["name"] = serde_json::Value::String(new_name.clone());
        json["description"] = serde_json::Value::String(format!("Workflow: {}", new_name));

        fs::write(
            &package_json_path,
            serde_json::to_string_pretty(&json).unwrap(),
        )
        .map_err(|e| format!("Failed to write package.json: {e}"))?;

        new_name
    } else {
        format!("CLONED workflow")
    };

    // Update state.json with new workflow_id and reset state
    let state_json_path = dest_path.join("state.json");
    if state_json_path.exists() {
        let content = fs::read_to_string(&state_json_path).map_err(|e| format!("Failed to read state.json: {e}"))?;
        let mut json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse state.json: {e}"))?;

        // Update workflow IDs
        json["workflow_id"] = serde_json::Value::String(new_workflow_id.clone());
        json["workflow_file"] = serde_json::Value::String(new_workflow_id.clone());

        // Reset execution state
        json["last_step_id"] = serde_json::Value::Null;
        json["last_step_index"] = serde_json::Value::Number(0.into());
        if let Some(env) = json.get_mut("env") {
            env["stepResults"] = serde_json::json!({});
            env["lastStepIndex"] = serde_json::Value::Number(0.into());
            env["lastStepId"] = serde_json::Value::Null;
        }

        fs::write(
            &state_json_path,
            serde_json::to_string_pretty(&json).unwrap(),
        )
        .map_err(|e| format!("Failed to write state.json: {e}"))?;
    }

    // Create fresh sync.json with new UUID (no cloud links - treat as new local workflow)
    let mediar_dir = dest_path.join(".mediar");
    if !mediar_dir.exists() {
        let _ = create_hidden_directory(&mediar_dir);
    }
    let sync_meta = SyncMetadata {
        last_synced_at: None,
        cloud_workflow_id: None,
        cloud_version: None,
        cloud_workflow_uuid: Some(new_workflow_id.clone()),
    };
    let sync_file = mediar_dir.join("sync.json");
    fs::write(
        &sync_file,
        serde_json::to_string_pretty(&sync_meta).map_err(|e| format!("Failed to serialize sync.json: {e}"))?,
    )
    .map_err(|e| format!("Failed to write sync.json: {e}"))?;
    info!(
        "📝 [CLONE] Created fresh sync.json with UUID: {}",
        new_workflow_id
    );

    info!(
        "✅ [CLONE] Cloned workflow '{}' -> '{}' at {}",
        workflow_id,
        new_workflow_id,
        dest_path.display()
    );

    Ok(CloneTypescriptWorkflowResult {
        id: new_workflow_id,
        path: dest_path.to_string_lossy().to_string(),
        name: original_name,
    })
}

/// Recursively copy directory contents, excluding specified folders
fn copy_dir_recursive(src: &Path, dst: &Path, exclude: &[&str]) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // Skip excluded directories
        if exclude.iter().any(|ex| file_name_str == *ex) {
            continue;
        }

        let src_path = entry.path();
        let dst_path = dst.join(&file_name);

        if src_path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| format!("Failed to create directory: {e}"))?;
            copy_dir_recursive(&src_path, &dst_path, exclude)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy file: {e}"))?;
        }
    }
    Ok(())
}

/// List all local TypeScript workflows
/// Scans the workflows directory for folders containing package.json + src/terminator.ts
#[tauri::command]
#[specta::specta]
pub async fn list_local_typescript_workflows() -> Result<Vec<LocalTypescriptWorkflow>, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    if !workflows_path.exists() {
        return Ok(vec![]);
    }

    let mut workflows = Vec::new();

    let entries = fs::read_dir(&workflows_path).map_err(|e| format!("Failed to read workflows directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        // Check if this is a TypeScript workflow (has package.json and src/terminator.ts)
        let package_json_path = path.join("package.json");
        let terminator_ts_path = path.join("src").join("terminator.ts");

        if !package_json_path.exists() || !terminator_ts_path.exists() {
            continue;
        }

        // Read package.json to get name and description
        let package_json_content = match fs::read_to_string(&package_json_path) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let package_json: serde_json::Value = match serde_json::from_str(&package_json_content) {
            Ok(json) => json,
            Err(_) => continue,
        };

        // Read name directly - all workflows now use readable name in this field
        let name = package_json
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let description = package_json
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let version = package_json
            .get("version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Get metadata from directory
        let metadata = fs::metadata(&path).ok();
        let created_at = metadata
            .as_ref()
            .and_then(|m| m.created().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        let modified_at = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        // Get current folder name
        let folder_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Get or create cloud_workflow_uuid from sync.json
        // This is the primary identifier used for both local and cloud operations
        let sync_file = path.join(".mediar").join("sync.json");
        let (workflow_uuid, current_path) = if sync_file.exists() {
            // Read existing sync.json
            if let Ok(content) = fs::read_to_string(&sync_file) {
                if let Ok(sync_data) = serde_json::from_str::<SyncMetadata>(&content) {
                    if let Some(uuid) = sync_data.cloud_workflow_uuid {
                        (uuid, path.clone())
                    } else {
                        // sync.json exists but no cloud_workflow_uuid - add it
                        // IMPORTANT: Reset last_synced_at to None so auto-push will create cloud record
                        // This fixes manually copied workflows that inherited last_synced_at from source
                        let new_uuid = uuid::Uuid::new_v4().to_string();
                        info!(
                            "🆕 Generating new UUID for workflow (no cloud_workflow_uuid): {}",
                            new_uuid
                        );
                        let updated_sync = SyncMetadata {
                            cloud_workflow_uuid: Some(new_uuid.clone()),
                            last_synced_at: None,    // Reset to trigger auto-push
                            cloud_workflow_id: None, // Reset cloud linkage
                            cloud_version: None,
                        };
                        if let Ok(json) = serde_json::to_string_pretty(&updated_sync) {
                            let _ = fs::write(&sync_file, json);
                        }
                        (new_uuid, path.clone())
                    }
                } else {
                    // Invalid JSON - create new
                    let new_uuid = uuid::Uuid::new_v4().to_string();
                    let sync_meta = SyncMetadata {
                        last_synced_at: None,
                        cloud_workflow_id: None,
                        cloud_version: None,
                        cloud_workflow_uuid: Some(new_uuid.clone()),
                    };
                    if let Ok(json) = serde_json::to_string_pretty(&sync_meta) {
                        let _ = fs::write(&sync_file, json);
                    }
                    (new_uuid, path.clone())
                }
            } else {
                // Can't read - create new UUID
                let new_uuid = uuid::Uuid::new_v4().to_string();
                (new_uuid, path.clone())
            }
        } else {
            // No sync.json - check if folder name is a valid UUID (legacy workflow)
            let is_uuid_folder = uuid::Uuid::parse_str(&folder_name).is_ok();

            if is_uuid_folder {
                // Legacy workflow: folder name IS the UUID
                // Migrate: create sync.json with this UUID, rename folder to workflow name
                info!(
                    "🔄 Migrating legacy UUID folder: {} -> {}",
                    folder_name, name
                );

                let cloud_uuid = folder_name.clone();

                // Create .mediar directory and sync.json
                let mediar_dir = path.join(".mediar");
                if create_hidden_directory(&mediar_dir).is_ok() {
                    let sync_meta = SyncMetadata {
                        last_synced_at: None,
                        cloud_workflow_id: None,
                        cloud_version: None,
                        cloud_workflow_uuid: Some(cloud_uuid.clone()),
                    };
                    if let Ok(json) = serde_json::to_string_pretty(&sync_meta) {
                        let _ = fs::write(mediar_dir.join("sync.json"), json);
                    }
                }

                // Rename folder to workflow name (sanitized)
                let sanitized_name = name
                    .to_lowercase()
                    .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
                    .trim_matches('-')
                    .to_string();

                // Handle duplicate names
                let mut new_folder_name = sanitized_name.clone();
                let mut counter = 1;
                while workflows_path.join(&new_folder_name).exists() && new_folder_name != folder_name {
                    counter += 1;
                    new_folder_name = format!("{}-{}", sanitized_name, counter);
                }

                // Rename the folder
                let new_path = workflows_path.join(&new_folder_name);
                if new_folder_name != folder_name {
                    match fs::rename(&path, &new_path) {
                        Ok(_) => {
                            info!("✅ Renamed folder: {} -> {}", folder_name, new_folder_name);
                            (cloud_uuid, new_path)
                        }
                        Err(e) => {
                            warn!("⚠️ Failed to rename folder: {} - {}", folder_name, e);
                            (cloud_uuid, path.clone())
                        }
                    }
                } else {
                    (cloud_uuid, path.clone())
                }
            } else {
                // New workflow without sync.json - create it with new UUID
                let new_uuid = uuid::Uuid::new_v4().to_string();

                let mediar_dir = path.join(".mediar");
                if create_hidden_directory(&mediar_dir).is_ok() {
                    let sync_meta = SyncMetadata {
                        last_synced_at: None,
                        cloud_workflow_id: None,
                        cloud_version: None,
                        cloud_workflow_uuid: Some(new_uuid.clone()),
                    };
                    if let Ok(json) = serde_json::to_string_pretty(&sync_meta) {
                        let _ = fs::write(mediar_dir.join("sync.json"), json);
                    }
                }

                (new_uuid, path.clone())
            }
        };

        // Ensure state.json exists for this workflow (create if missing)
        if let Err(e) = create_initial_state_file(&current_path, &workflow_uuid) {
            warn!(
                "⚠️ Failed to create state.json for {}: {}",
                workflow_uuid, e
            );
        }

        workflows.push(LocalTypescriptWorkflow {
            id: workflow_uuid, // UUID - primary identifier for local and cloud
            name,
            description,
            version,
            path: current_path.to_string_lossy().to_string(),
            created_at,
            modified_at,
            cloud_id: None, // Deprecated - id is now the UUID
        });
    }

    // Sort by modified date, newest first
    workflows.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    info!("📋 Found {} local TypeScript workflows", workflows.len());

    Ok(workflows)
}

/// Read all files from a TypeScript workflow
/// Returns the main terminator.ts file and all step files
#[tauri::command]
#[specta::specta]
pub async fn read_typescript_workflow_files(workflow_id: String) -> Result<ReadTypescriptWorkflowResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID (checks sync.json in each folder)
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    // Read terminator.ts
    let terminator_ts_path = workflow_path.join("src").join("terminator.ts");
    let terminator_ts =
        fs::read_to_string(&terminator_ts_path).map_err(|e| format!("Failed to read terminator.ts: {e}"))?;

    // Read package.json
    let package_json_path = workflow_path.join("package.json");
    let package_json =
        fs::read_to_string(&package_json_path).map_err(|e| format!("Failed to read package.json: {e}"))?;

    // Read all step files
    let steps_dir = workflow_path.join("src").join("steps");
    let mut steps = Vec::new();

    if steps_dir.exists() {
        let entries = fs::read_dir(&steps_dir).map_err(|e| format!("Failed to read steps directory: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();

            if path.extension().map(|e| e == "ts").unwrap_or(false) {
                let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read step file: {e}"))?;

                let relative_path = path
                    .strip_prefix(&workflow_path)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| path.to_string_lossy().to_string());

                steps.push(WorkflowFileContent {
                    path: relative_path,
                    content,
                    is_step: true,
                });
            }
        }
    }

    // Sort steps by filename
    steps.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(ReadTypescriptWorkflowResult {
        id: workflow_id,
        terminator_ts,
        steps,
        package_json,
    })
}

/// Ensure tsconfig.json exists in a TypeScript workflow
/// Creates it with standard settings if missing (needed for tsc --noEmit to work)
fn ensure_tsconfig_exists(workflow_path: &Path) {
    let tsconfig_path = workflow_path.join("tsconfig.json");
    let package_json_path = workflow_path.join("package.json");

    // Only create tsconfig if this is a TypeScript workflow (has package.json) but missing tsconfig
    if package_json_path.exists() && !tsconfig_path.exists() {
        info!("📝 Creating missing tsconfig.json for workflow");

        let tsconfig_content = r#"{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
"#;

        if let Err(e) = fs::write(&tsconfig_path, tsconfig_content) {
            warn!("⚠️ Failed to create tsconfig.json: {}", e);
        } else {
            info!("✅ Created tsconfig.json");
        }
    }
}

/// Prepare a TypeScript workflow by installing dependencies
/// Called when a workflow is opened/selected in the UI
#[tauri::command]
#[specta::specta]
pub async fn prepare_typescript_workflow(workflow_id: String) -> Result<bool, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    info!("🔧 Preparing workflow: {}", workflow_id);

    // Ensure tsconfig.json exists (needed for TypeScript compilation)
    ensure_tsconfig_exists(&workflow_path);

    // Sanitize package.json to fix file: dependencies (fixes existing workflows)
    sanitize_package_json_dependencies(&workflow_path);

    let success = install_workflow_dependencies(&workflow_path);
    Ok(success)
}

/// Write a file in a TypeScript workflow
/// Used for autosave when editing workflow files in the UI
#[tauri::command]
#[specta::specta]
pub async fn write_typescript_workflow_file(
    input: WriteTypescriptWorkflowFileInput,
) -> Result<WriteTypescriptWorkflowFileResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &input.workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", input.workflow_id))?;

    // Resolve the file path relative to workflow directory
    let file_path = workflow_path.join(&input.file_path);

    // Security check: ensure the resolved path is within the workflow directory
    let canonical_workflow = workflow_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve workflow path: {e}"))?;

    // Create parent directories if they don't exist
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {e}"))?;
        }
    }

    let canonical_file = file_path
        .canonicalize()
        .unwrap_or_else(|_| file_path.clone());

    if !canonical_file.starts_with(&canonical_workflow) {
        return Err("Invalid file path: path traversal detected".to_string());
    }

    // Write the file
    fs::write(&file_path, &input.content).map_err(|e| format!("Failed to write file: {e}"))?;

    info!(
        "📝 Wrote TypeScript workflow file: {} ({} bytes)",
        input.file_path,
        input.content.len()
    );

    Ok(WriteTypescriptWorkflowFileResult {
        success: true,
        path: file_path.to_string_lossy().to_string(),
    })
}

/// Publish a TypeScript workflow to the cloud
/// Reads local files and uploads to the API
#[tauri::command]
#[specta::specta]
pub async fn publish_typescript_workflow(
    input: PublishTypescriptWorkflowInput,
) -> Result<PublishTypescriptWorkflowResult, String> {
    use crate::auth::retrieve_auth_token;
    use reqwest::Client;

    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &input.workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", input.workflow_id))?;

    // Read cloud UUID from sync.json (required for publishing)
    let sync_path = workflow_path.join(".mediar").join("sync.json");
    let cloud_uuid = if sync_path.exists() {
        let sync_content = fs::read_to_string(&sync_path).map_err(|e| format!("Failed to read sync.json: {e}"))?;
        let sync_meta: SyncMetadata =
            serde_json::from_str(&sync_content).map_err(|e| format!("Failed to parse sync.json: {e}"))?;
        sync_meta
            .cloud_workflow_uuid
            .ok_or_else(|| "Workflow missing cloud_workflow_uuid in sync.json - please recreate workflow".to_string())?
    } else {
        // Legacy workflow without sync.json - generate UUID now
        let new_uuid = uuid::Uuid::new_v4().to_string();
        info!(
            "📝 Legacy workflow missing sync.json, generating UUID: {}",
            new_uuid
        );

        let mediar_dir = workflow_path.join(".mediar");
        create_hidden_directory(&mediar_dir).map_err(|e| format!("Failed to create .mediar: {e}"))?;

        let sync_metadata = SyncMetadata {
            last_synced_at: None,
            cloud_workflow_id: None,
            cloud_version: None,
            cloud_workflow_uuid: Some(new_uuid.clone()),
        };
        let sync_json =
            serde_json::to_string_pretty(&sync_metadata).map_err(|e| format!("Failed to serialize sync.json: {e}"))?;
        fs::write(&sync_path, sync_json).map_err(|e| format!("Failed to write sync.json: {e}"))?;

        new_uuid
    };

    info!("📤 Publishing with cloud_uuid: {}", cloud_uuid);

    // Read terminator.ts
    let terminator_path = workflow_path.join("src").join("terminator.ts");
    let terminator_ts =
        fs::read_to_string(&terminator_path).map_err(|e| format!("Failed to read terminator.ts: {e}"))?;

    // Collect all TypeScript files
    let mut files: Vec<PublishFile> = Vec::new();
    let src_dir = workflow_path.join("src");

    fn collect_ts_files(dir: &PathBuf, base: &PathBuf, files: &mut Vec<PublishFile>) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {e}"))? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                collect_ts_files(&path, base, files)?;
            } else if path.extension().map_or(false, |ext| ext == "ts") {
                let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))?;
                let relative_path = path
                    .strip_prefix(base)
                    .map_err(|e| format!("Failed to get relative path: {e}"))?;
                files.push(PublishFile {
                    path: relative_path
                        .to_string_lossy()
                        .to_string()
                        .replace('\\', "/"),
                    content,
                });
            }
        }
        Ok(())
    }

    collect_ts_files(&src_dir, &workflow_path, &mut files)?;

    // Get auth token
    let token = retrieve_auth_token()
        .map_err(|e| format!("Failed to get auth token: {e}"))?
        .ok_or_else(|| "Not authenticated - please sign in".to_string())?;

    // Get API base URL
    let api_base = std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string());

    // Build request payload
    #[derive(Serialize)]
    struct PublishRequest {
        folder_id: String, // UUID - used as github_folder in database
        name: String,
        description: Option<String>,
        terminator_ts: String,
        files: Vec<PublishFile>,
    }

    let payload = PublishRequest {
        folder_id: cloud_uuid.clone(), // UUID from sync.json
        name: input.name.clone(),
        description: input.description.clone(),
        terminator_ts,
        files,
    };

    info!(
        "📤 Publishing TypeScript workflow '{}' to cloud...",
        input.name
    );

    // Make API request
    let client = Client::new();
    let response = client
        .post(format!("{}/api/workflows/publish-typescript", api_base))
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        error!("❌ Publish failed: {} - {}", status, body);
        return Err(format!("Publish failed: {}", body));
    }

    #[derive(Deserialize)]
    struct PublishResponse {
        success: bool,
        workflow_id: i64,
        version: String,
        step_count: usize,
        updated_at: Option<String>,
        #[allow(dead_code)]
        error: Option<String>,
    }

    let result: PublishResponse = serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))?;

    if !result.success {
        return Err(format!(
            "Publish failed: {}",
            result.error.unwrap_or_default()
        ));
    }

    info!(
        "✅ Published workflow '{}' to cloud: ID={}, version={}",
        input.name, result.workflow_id, result.version
    );
    info!("📝 Server returned updated_at: {:?}", result.updated_at);

    // Save sync metadata locally - use server's updated_at to ensure timestamp consistency
    let last_synced_at = result
        .updated_at
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let sync_metadata = serde_json::json!({
        "last_synced_at": last_synced_at,
        "cloud_workflow_id": result.workflow_id,
        "cloud_version": result.version,
        // Store folder name as cloud_workflow_uuid - this is the github_folder in the database
        // For new workflows, folder name IS the UUID; for legacy workflows, this enables cloud sync
        "cloud_workflow_uuid": input.workflow_id,
    });

    let mediar_dir = workflow_path.join(".mediar");
    create_hidden_directory(&mediar_dir).ok();
    let sync_file = mediar_dir.join("sync.json");
    if let Err(e) = fs::write(
        &sync_file,
        serde_json::to_string_pretty(&sync_metadata).unwrap_or_default(),
    ) {
        error!("Failed to save sync metadata: {}", e);
    }

    Ok(PublishTypescriptWorkflowResult {
        success: true,
        cloud_workflow_id: result.workflow_id,
        version: result.version,
        step_count: result.step_count,
    })
}

/// Get sync metadata for a TypeScript workflow
#[tauri::command]
#[specta::specta]
pub async fn get_workflow_sync_metadata(workflow_id: String) -> Result<SyncMetadata, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Use find_workflow_path_by_uuid to find the actual folder (may not be named by UUID)
    let workflow_path = match find_workflow_path_by_uuid(&workflows_path, &workflow_id) {
        Some(path) => path,
        None => {
            info!(
                "📋 [SYNC_META] Workflow folder not found for UUID: {}",
                workflow_id
            );
            return Ok(SyncMetadata {
                last_synced_at: None,
                cloud_workflow_id: None,
                cloud_version: None,
                cloud_workflow_uuid: None,
            });
        }
    };

    let sync_file = workflow_path.join(".mediar").join("sync.json");

    if !sync_file.exists() {
        info!("📋 [SYNC_META] No sync.json found at: {:?}", sync_file);
        return Ok(SyncMetadata {
            last_synced_at: None,
            cloud_workflow_id: None,
            cloud_version: None,
            cloud_workflow_uuid: None,
        });
    }

    let content = fs::read_to_string(&sync_file).map_err(|e| format!("Failed to read sync metadata: {e}"))?;
    info!("📋 [SYNC_META] Read sync.json from: {:?}", sync_file);

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse sync metadata: {e}"))
}

/// Check remote workflow status by UUID (github_folder)
#[tauri::command]
#[specta::specta]
pub async fn check_remote_workflow_status(workflow_id: String) -> Result<RemoteSyncStatus, String> {
    use crate::auth::retrieve_auth_token;
    use reqwest::Client;

    // Get local sync metadata
    let local_metadata = get_workflow_sync_metadata(workflow_id.clone()).await?;

    // Get auth token
    let token = match retrieve_auth_token() {
        Ok(Some(t)) => t,
        _ => {
            return Ok(RemoteSyncStatus {
                has_remote: false,
                remote_updated_at: None,
                local_synced_at: local_metadata.last_synced_at,
                needs_pull: false,
                remote_version: None,
                local_version: local_metadata.cloud_version,
                is_owner: true, // Assume owner if not authenticated
            });
        }
    };

    // Get API base URL
    let api_base = std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string());

    // Check remote status
    let client = Client::new();
    let response = client
        .get(format!(
            "{}/api/workflows/sync-status/{}",
            api_base, workflow_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Failed to check remote status: {e}"))?;

    let status_code = response.status();
    if !status_code.is_success() {
        // 403 = workflow exists but current user is not the owner
        if status_code == reqwest::StatusCode::FORBIDDEN {
            info!(
                "🔒 [SYNC] Workflow {} exists but not owned by current user",
                workflow_id
            );
            return Ok(RemoteSyncStatus {
                has_remote: true,
                remote_updated_at: None,
                local_synced_at: local_metadata.last_synced_at,
                needs_pull: false,
                remote_version: None,
                local_version: local_metadata.cloud_version,
                is_owner: false, // Not authorized to push changes
            });
        }
        // 404 or other errors = workflow doesn't exist in cloud
        return Ok(RemoteSyncStatus {
            has_remote: false,
            remote_updated_at: None,
            local_synced_at: local_metadata.last_synced_at,
            needs_pull: false,
            remote_version: None,
            local_version: local_metadata.cloud_version,
            is_owner: true, // Assume owner for new workflows
        });
    }

    #[derive(Deserialize)]
    struct RemoteStatus {
        updated_at: Option<String>,
        latest_version: Option<String>,
    }

    let remote: RemoteStatus = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse remote status: {e}"))?;

    // Compare versions to determine if pull is needed (using semver comparison)
    let needs_pull = match (&remote.latest_version, &local_metadata.cloud_version) {
        (Some(remote_ver), Some(local_ver)) => {
            // Parse semver and compare: needs_pull if remote > local
            compare_versions(remote_ver, local_ver) == std::cmp::Ordering::Greater
        }
        (Some(_), None) => true, // Remote has version but we never synced
        _ => false,
    };

    Ok(RemoteSyncStatus {
        has_remote: true,
        remote_updated_at: remote.updated_at,
        local_synced_at: local_metadata.last_synced_at,
        needs_pull,
        remote_version: remote.latest_version,
        local_version: local_metadata.cloud_version,
        is_owner: true, // API returned success, user is the owner
    })
}

/// Download a TypeScript workflow from cloud by UUID
/// Downloads a ZIP file from the new /api/workflows-uuid/download endpoint and extracts it
#[tauri::command]
#[specta::specta]
pub async fn download_cloud_workflow(workflow_uuid: String) -> Result<DownloadWorkflowResult, String> {
    use crate::auth::retrieve_auth_token;
    use reqwest::Client;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    // Get auth token
    let token = retrieve_auth_token()
        .map_err(|e| format!("Failed to get auth token: {e}"))?
        .ok_or_else(|| "Not authenticated - please sign in".to_string())?;

    // Get API base URL
    let api_base = std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string());

    info!(
        "📥 Downloading workflow {} from cloud (ZIP)...",
        workflow_uuid
    );

    // Download ZIP from new UUID-based endpoint
    let client = Client::new();
    let response = client
        .get(format!(
            "{}/api/workflows-uuid/download?uuid={}",
            api_base, workflow_uuid
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Failed to download workflow: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Download failed: {} - {}", status, body));
    }

    // Get workflow info from response headers
    let workflow_name = response
        .headers()
        .get("X-Workflow-Name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let workflow_version = response
        .headers()
        .get("X-Workflow-Version")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("1.0.0")
        .to_string();

    // Download ZIP bytes
    let zip_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to download ZIP: {e}"))?;

    info!("📦 Downloaded {} bytes, extracting...", zip_bytes.len());

    // Create local folder structure using UUID as folder name
    let workflows_dir = get_workflows_directory_sync()?;
    let workflow_path = PathBuf::from(&workflows_dir).join(&workflow_uuid);

    if workflow_path.exists() {
        return Err(format!("Workflow folder already exists: {}", workflow_uuid));
    }

    // Create workflow directory
    fs::create_dir_all(&workflow_path).map_err(|e| format!("Failed to create workflow directory: {e}"))?;

    // Extract ZIP to workflow directory
    let cursor = Cursor::new(zip_bytes.to_vec());
    let mut archive = ZipArchive::new(cursor).map_err(|e| format!("Failed to open ZIP archive: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {e}"))?;

        let outpath = match file.enclosed_name() {
            Some(path) => workflow_path.join(path),
            None => continue, // Skip invalid paths
        };

        if file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create directory: {e}"))?;
        } else {
            // Create parent directories
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directory: {e}"))?;
            }

            // Write file contents
            let mut contents = Vec::new();
            file.read_to_end(&mut contents)
                .map_err(|e| format!("Failed to read ZIP file contents: {e}"))?;
            fs::write(&outpath, &contents).map_err(|e| format!("Failed to write file: {e}"))?;
        }
    }

    info!("✅ Extracted {} files from ZIP", archive.len());

    // Save sync metadata
    let sync_metadata = serde_json::json!({
        "last_synced_at": chrono::Utc::now().to_rfc3339(),
        "cloud_workflow_uuid": workflow_uuid,
        "cloud_version": workflow_version,
    });

    let mediar_dir = workflow_path.join(".mediar");
    create_hidden_directory(&mediar_dir).map_err(|e| format!("Failed to create .mediar directory: {e}"))?;

    let sync_json_content =
        serde_json::to_string_pretty(&sync_metadata).map_err(|e| format!("Failed to serialize sync.json: {e}"))?;
    fs::write(mediar_dir.join("sync.json"), &sync_json_content)
        .map_err(|e| format!("Failed to write sync.json: {e}"))?;
    info!("📝 [DOWNLOAD] Wrote sync.json with UUID: {}", workflow_uuid);

    // Sanitize package.json to replace file: dependencies with npm versions
    // This is needed because workflows downloaded from cloud may contain
    // hardcoded local file paths from the original developer's machine
    sanitize_package_json_dependencies(&workflow_path);

    // Set name in package.json to readable name
    set_package_json_name(&workflow_path, &workflow_name);

    // Ensure tsconfig.json exists (needed for TypeScript compilation)
    ensure_tsconfig_exists(&workflow_path);

    // Install dependencies (don't fail download on install failure)
    install_workflow_dependencies(&workflow_path);

    info!(
        "✅ Downloaded workflow '{}' to {}",
        workflow_name,
        workflow_path.display()
    );

    Ok(DownloadWorkflowResult {
        success: true,
        workflow_id: workflow_uuid,
        name: workflow_name,
        path: workflow_path.to_string_lossy().to_string(),
    })
}

/// Result of pulling (updating) a TypeScript workflow from cloud
#[derive(Debug, Serialize, specta::Type)]
pub struct PullWorkflowResult {
    pub success: bool,
    pub workflow_id: String,
    pub version: String,
    pub files_updated: usize,
}

/// Pull (update) an existing TypeScript workflow from cloud
/// Downloads the latest version from cloud and overwrites local files
#[tauri::command]
#[specta::specta]
pub async fn pull_typescript_workflow(workflow_id: String) -> Result<PullWorkflowResult, String> {
    use crate::auth::retrieve_auth_token;
    use reqwest::Client;
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found locally: {}", workflow_id))?;

    // Get auth token
    let token = retrieve_auth_token()
        .map_err(|e| format!("Failed to get auth token: {e}"))?
        .ok_or_else(|| "Not authenticated - please sign in".to_string())?;

    // Get API base URL
    let api_base = std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string());

    info!("📥 Pulling workflow {} from cloud...", workflow_id);

    // Download ZIP from UUID-based endpoint
    let client = Client::new();
    let response = client
        .get(format!(
            "{}/api/workflows-uuid/download?uuid={}",
            api_base, workflow_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Failed to download workflow: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Pull failed: {} - {}", status, body));
    }

    // Get workflow version from response headers
    let workflow_version = response
        .headers()
        .get("X-Workflow-Version")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("1.0.0")
        .to_string();

    // Download ZIP bytes
    let zip_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to download ZIP: {e}"))?;

    info!("📦 Downloaded {} bytes, extracting...", zip_bytes.len());

    // Extract ZIP to workflow directory (overwriting existing files)
    let cursor = Cursor::new(zip_bytes.to_vec());
    let mut archive = ZipArchive::new(cursor).map_err(|e| format!("Failed to open ZIP archive: {e}"))?;

    let mut files_updated = 0;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {e}"))?;

        let outpath = match file.enclosed_name() {
            Some(path) => workflow_path.join(path),
            None => continue,
        };

        if file.is_dir() {
            fs::create_dir_all(&outpath).ok();
        } else {
            // Create parent directories
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).ok();
            }

            // Write file contents (overwrite existing)
            let mut contents = Vec::new();
            file.read_to_end(&mut contents)
                .map_err(|e| format!("Failed to read ZIP file contents: {e}"))?;
            fs::write(&outpath, &contents).map_err(|e| format!("Failed to write file: {e}"))?;
            files_updated += 1;
        }
    }

    info!("✅ Updated {} files from cloud", files_updated);

    // Update sync metadata
    let sync_metadata = serde_json::json!({
        "last_synced_at": chrono::Utc::now().to_rfc3339(),
        "cloud_workflow_uuid": workflow_id,
        "cloud_version": workflow_version,
    });

    let mediar_dir = workflow_path.join(".mediar");
    create_hidden_directory(&mediar_dir).map_err(|e| format!("Failed to create .mediar directory: {e}"))?;

    let sync_json_content =
        serde_json::to_string_pretty(&sync_metadata).map_err(|e| format!("Failed to serialize sync.json: {e}"))?;
    fs::write(mediar_dir.join("sync.json"), &sync_json_content)
        .map_err(|e| format!("Failed to write sync.json: {e}"))?;
    info!("📝 [PULL] Updated sync.json with UUID: {}", workflow_id);

    // Sanitize package.json dependencies
    sanitize_package_json_dependencies(&workflow_path);

    // Ensure tsconfig.json exists (needed for TypeScript compilation)
    ensure_tsconfig_exists(&workflow_path);

    // Reinstall dependencies
    install_workflow_dependencies(&workflow_path);

    info!(
        "✅ Pulled workflow {} to version {}",
        workflow_id, workflow_version
    );

    Ok(PullWorkflowResult {
        success: true,
        workflow_id,
        version: workflow_version,
        files_updated,
    })
}

/// Result of deleting a TypeScript workflow
#[derive(Debug, Serialize, specta::Type)]
pub struct DeleteTypescriptWorkflowResult {
    pub success: bool,
    pub local_deleted: bool,
    pub cloud_archived: bool,
    pub message: String,
}

/// Delete a TypeScript workflow (local folder + cloud archive)
///
/// - Deletes the local folder found by UUID lookup
/// - Archives the workflow in the cloud via DELETE /api/remote-workflows/{uuid}
#[tauri::command]
#[specta::specta]
pub async fn delete_typescript_workflow(folder_id: String) -> Result<DeleteTypescriptWorkflowResult, String> {
    use crate::auth::retrieve_auth_token;
    use reqwest::Client;

    info!("🗑️ Deleting TypeScript workflow: {}", folder_id);

    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Track what we've done
    let mut local_deleted = false;
    let mut cloud_archived = false;
    let mut messages: Vec<String> = Vec::new();

    // Step 1: Find and delete local folder
    if let Some(workflow_path) = find_workflow_path_by_uuid(&workflows_path, &folder_id) {
        info!("📁 Deleting local folder: {}", workflow_path.display());
        match fs::remove_dir_all(&workflow_path) {
            Ok(_) => {
                local_deleted = true;
                messages.push(format!("Deleted local folder: {}", folder_id));
                info!("✅ Local folder deleted");
            }
            Err(e) => {
                error!("❌ Failed to delete local folder: {e}");
                return Err(format!("Failed to delete local folder: {e}"));
            }
        }
    } else {
        messages.push("No local folder found (cloud-only workflow)".to_string());
        info!("ℹ️ No local folder found - may be cloud-only workflow");
    }

    // Step 2: Archive from cloud (fire DELETE request to /api/remote-workflows/{folder_id})
    // Try to get auth token - if not authenticated, skip cloud deletion
    match retrieve_auth_token() {
        Ok(Some(token)) => {
            let api_base = std::env::var("MEDIAR_API_URL").unwrap_or_else(|_| "https://app.mediar.ai".to_string());

            let client = Client::new();
            let url = format!("{}/api/remote-workflows/{}", api_base, folder_id);

            info!("☁️ Archiving workflow from cloud: {}", url);

            match client
                .delete(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await
            {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        cloud_archived = true;
                        messages.push("Archived from cloud".to_string());
                        info!("✅ Workflow archived from cloud");
                    } else if status.as_u16() == 404 {
                        // Workflow not found in cloud - that's OK
                        messages.push("Not found in cloud (local-only workflow)".to_string());
                        info!("ℹ️ Workflow not found in cloud - may be local-only");
                    } else {
                        let error_text = response.text().await.unwrap_or_default();
                        warn!("⚠️ Cloud archive failed: {} - {}", status, error_text);
                        messages.push(format!("Cloud archive failed: {}", status));
                    }
                }
                Err(e) => {
                    warn!("⚠️ Failed to connect to cloud: {e}");
                    messages.push(format!("Could not connect to cloud: {e}"));
                }
            }
        }
        Ok(None) => {
            messages.push("Not authenticated - skipped cloud archive".to_string());
            info!("ℹ️ Not authenticated - skipping cloud archive");
        }
        Err(e) => {
            warn!("⚠️ Failed to get auth token: {e}");
            messages.push(format!("Auth error - skipped cloud archive: {e}"));
        }
    }

    // Must have deleted something to be considered successful
    let success = local_deleted || cloud_archived;

    if success {
        info!("✅ TypeScript workflow deleted: {}", folder_id);
    } else {
        warn!("⚠️ Nothing was deleted for workflow: {}", folder_id);
    }

    Ok(DeleteTypescriptWorkflowResult {
        success,
        local_deleted,
        cloud_archived,
        message: messages.join("; "),
    })
}

/// Read the file tree structure for a workflow (metadata only, no content)
/// Returns a tree structure like an IDE file explorer
#[tauri::command]
#[specta::specta]
pub async fn read_workflow_file_tree(workflow_id: String) -> Result<WorkflowFileTreeResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    fn build_tree(dir: &Path, base_path: &Path) -> Result<Vec<FileTreeNode>, String> {
        let mut nodes = Vec::new();

        let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            let relative_path = path
                .strip_prefix(base_path)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());

            let is_directory = path.is_dir();

            let children = if is_directory {
                Some(build_tree(&path, base_path)?)
            } else {
                None
            };

            nodes.push(FileTreeNode {
                name,
                path: relative_path,
                is_directory,
                children,
            });
        }

        // Sort: directories first, then alphabetically by name
        nodes.sort_by(|a, b| match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(nodes)
    }

    let root = build_tree(&workflow_path, &workflow_path)?;

    Ok(WorkflowFileTreeResult { workflow_id, root })
}

/// Read a single file from a workflow
/// Used for lazy loading file content when user clicks on a file
#[tauri::command]
#[specta::specta]
pub async fn read_workflow_file(workflow_id: String, file_path: String) -> Result<WorkflowFileContentResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    // Normalize and validate file path (prevent path traversal)
    let normalized_path = file_path.replace('\\', "/");
    if normalized_path.contains("..") {
        return Err("Invalid file path: path traversal not allowed".to_string());
    }

    let full_path = workflow_path.join(&normalized_path);

    if !full_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    if full_path.is_dir() {
        return Err(format!("Path is a directory: {}", file_path));
    }

    // Check if file is binary by reading first bytes
    let bytes = fs::read(&full_path).map_err(|e| format!("Failed to read file: {e}"))?;

    // Detect image files by extension
    let extension = full_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime_type = match extension.to_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    };
    let is_image = mime_type.is_some();

    // Simple binary detection: check for null bytes in first 8KB
    let check_len = bytes.len().min(8192);
    let is_binary = bytes[..check_len].contains(&0);

    let content = if is_image {
        // Return base64-encoded image data
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.encode(&bytes)
    } else if is_binary {
        format!("[Binary file: {} bytes]", bytes.len())
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    Ok(WorkflowFileContentResult {
        path: normalized_path,
        content,
        is_binary: is_binary || is_image,
        mime_type: mime_type.map(|s| s.to_string()),
    })
}

/// Result of getting step execution log
#[derive(Debug, Serialize, specta::Type)]
pub struct StepExecutionLogResult {
    pub found: bool,
    pub file_path: Option<String>,
    pub content: Option<String>,
    pub timestamp: Option<String>,
}

/// Get the most recent execution log for a specific step
/// Searches in the workflow's executions/ subfolder for matching step_id
#[tauri::command]
#[specta::specta]
pub async fn get_step_execution_log(workflow_id: String, step_id: String) -> Result<StepExecutionLogResult, String> {
    use std::fs;

    // Get workflows directory and resolve UUID to actual folder path
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID (resolves to actual folder path like "test" instead of UUID)
    let workflow_path = match find_workflow_path_by_uuid(&workflows_path, &workflow_id) {
        Some(path) => path,
        None => {
            info!(
                "[get_step_execution_log] Workflow not found for UUID {}",
                workflow_id
            );
            return Ok(StepExecutionLogResult {
                found: false,
                file_path: None,
                content: None,
                timestamp: None,
            });
        }
    };

    let executions_dir = workflow_path.join("executions");
    info!(
        "[get_step_execution_log] Scanning workflow dir: {:?}",
        executions_dir
    );

    if !executions_dir.exists() {
        return Ok(StepExecutionLogResult {
            found: false,
            file_path: None,
            content: None,
            timestamp: None,
        });
    }

    // Scan for .json files matching step_id (already in workflow-specific folder)
    // Filename format: YYYYMMDD_HHMMSS_workflowId_stepId_toolName.json
    let mut matching_files: Vec<(String, String, std::time::SystemTime)> = Vec::new();
    info!(
        "[get_step_execution_log] Looking for workflow_id={}, step_id={}",
        workflow_id, step_id
    );

    let mut json_files_count = 0;
    let mut filename_matches_count = 0;
    if let Ok(entries) = fs::read_dir(&executions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                json_files_count += 1;
                let filename = path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Fast path: Check if filename contains step_id
                if !filename.contains(&step_id) {
                    continue;
                }
                filename_matches_count += 1;

                if let Ok(content) = fs::read_to_string(&path) {
                    // Verify step_id matches in JSON to be safe
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(req) = json.get("request") {
                            let req_start_step = req.get("start_from_step").and_then(|v| v.as_str());
                            let req_end_step = req.get("end_at_step").and_then(|v| v.as_str());

                            // Fix: use step_id.as_str() for proper type comparison
                            let step_matches =
                                req_start_step == Some(step_id.as_str()) || req_end_step == Some(step_id.as_str());

                            if step_matches {
                                if let Ok(metadata) = entry.metadata() {
                                    if let Ok(modified) = metadata.modified() {
                                        matching_files.push((path.to_string_lossy().to_string(), content, modified));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    info!(
        "[get_step_execution_log] Scanned {} JSON files, {} filename matches, {} final matches",
        json_files_count,
        filename_matches_count,
        matching_files.len()
    );

    // Sort by modification time (most recent first) and return the first match
    matching_files.sort_by(|a, b| b.2.cmp(&a.2));

    if let Some((file_path, content, _)) = matching_files.into_iter().next() {
        // Extract timestamp from the JSON
        let timestamp = serde_json::from_str::<serde_json::Value>(&content)
            .ok()
            .and_then(|json| {
                json.get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });

        info!("[get_step_execution_log] ✅ Found log file: {}", file_path);
        Ok(StepExecutionLogResult {
            found: true,
            file_path: Some(file_path),
            content: Some(content),
            timestamp,
        })
    } else {
        info!("[get_step_execution_log] ❌ No matching log file found");
        Ok(StepExecutionLogResult {
            found: false,
            file_path: None,
            content: None,
            timestamp: None,
        })
    }
}

/// A standalone tool execution from the local executions folder
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StandaloneToolExecution {
    pub id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub duration_ms: u64,
    pub succeeded: bool,
    pub timestamp: String,
    pub file_path: String,
    /// TypeScript definition content from the corresponding .ts file
    pub definition: Option<String>,
    /// Captured console logs from execution
    pub logs: Option<Vec<CapturedLogEntry>>,
}

/// Log entry captured during tool execution
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CapturedLogEntry {
    pub timestamp: Option<String>,
    pub level: String,
    pub message: String,
}

/// Get standalone tool executions from local filesystem
/// Scans %LOCALAPPDATA%\mediar\executions\ for standalone_*.json files
#[tauri::command]
#[specta::specta]
pub async fn get_standalone_tool_history(limit: Option<usize>) -> Result<Vec<StandaloneToolExecution>, String> {
    use std::fs;

    let limit = limit.unwrap_or(50);
    log::info!(
        "[TOOL-HISTORY] get_standalone_tool_history called, limit={}",
        limit
    );

    // Get mediar standalone executions directory: mediar/executions/
    let executions_dir = if cfg!(target_os = "windows") {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string()));
        std::path::PathBuf::from(local_app_data)
            .join("mediar")
            .join("executions")
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("mediar")
            .join("executions")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("mediar")
            .join("executions")
    };

    log::info!("[TOOL-HISTORY] Scanning directory: {:?}", executions_dir);

    if !executions_dir.exists() {
        log::info!("[TOOL-HISTORY] Directory does not exist");
        return Ok(Vec::new());
    }

    // Collect standalone JSON files with their modification times
    let mut files: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();

    if let Ok(entries) = fs::read_dir(&executions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // Match pattern: *_standalone_*.json
            if file_name.contains("_standalone_") && file_name.ends_with(".json") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        files.push((path, modified));
                    }
                }
            }
        }
    }

    log::info!("[TOOL-HISTORY] Found {} standalone files", files.len());

    // Sort by modification time (most recent first)
    files.sort_by(|a, b| b.1.cmp(&a.1));

    // Take only the requested limit
    let files: Vec<_> = files.into_iter().take(limit).collect();

    // Parse each file
    let mut executions: Vec<StandaloneToolExecution> = Vec::new();

    // Tools to exclude from buffer (filesystem tools and workflow execution)
    const EXCLUDED_TOOLS: &[&str] = &[
        "read_file",
        "edit_file",
        "write_file",
        "glob_files",
        "grep_files",
        "execute_sequence",
    ];

    for (path, _) in files {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let tool_name = json
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                // Skip excluded tools (filesystem, workflow execution)
                if EXCLUDED_TOOLS.contains(&tool_name.as_str()) {
                    continue;
                }

                let timestamp = json
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let request = json
                    .get("request")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                let response = json.get("response");
                let status = response
                    .and_then(|r| r.get("status"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("unknown");

                let duration_ms = response
                    .and_then(|r| r.get("duration_ms"))
                    .and_then(|d| d.as_u64())
                    .unwrap_or(0);

                let result = response.and_then(|r| r.get("result")).cloned();

                let error = if status == "failed" {
                    response
                        .and_then(|r| r.get("error"))
                        .and_then(|e| e.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                };

                // Use file name as ID (unique per execution)
                let id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&timestamp)
                    .to_string();

                // Try to read corresponding .ts file for definition
                let ts_path = path.with_extension("ts");
                let definition = if ts_path.exists() {
                    fs::read_to_string(&ts_path).ok()
                } else {
                    None
                };

                // Parse logs from multiple sources:
                // 1. Root-level "logs" array (MCP agent debug logs with timestamp/level/message)
                // 2. response.result.content[0].logs (run_command console.log output)
                // 3. response.result.content[0].stderr (run_command console.error output)
                let mut all_logs: Vec<CapturedLogEntry> = Vec::new();

                // Source 1: Root-level logs (structured MCP debug logs)
                if let Some(logs_arr) = json.get("logs").and_then(|v| v.as_array()) {
                    for entry in logs_arr {
                        let level = entry
                            .get("level")
                            .and_then(|v| v.as_str())
                            .unwrap_or("log")
                            .to_string();
                        let message = entry
                            .get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let timestamp = entry
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        if !message.is_empty() {
                            all_logs.push(CapturedLogEntry {
                                timestamp,
                                level,
                                message,
                            });
                        }
                    }
                }

                // Source 2 & 3: run_command console output (logs and stderr arrays)
                // Located at response.result.content[0].logs and response.result.content[0].stderr
                if let Some(content_arr) = response
                    .and_then(|r| r.get("result"))
                    .and_then(|r| r.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for content_item in content_arr {
                        // Parse logs array (console.log output)
                        if let Some(logs_arr) = content_item.get("logs").and_then(|v| v.as_array()) {
                            for log_entry in logs_arr {
                                let message = if let Some(s) = log_entry.as_str() {
                                    s.to_string()
                                } else {
                                    log_entry.to_string()
                                };
                                if !message.is_empty() {
                                    all_logs.push(CapturedLogEntry {
                                        timestamp: None,
                                        level: "log".to_string(),
                                        message,
                                    });
                                }
                            }
                        }
                        // Parse stderr array (console.error/warn output)
                        if let Some(stderr_arr) = content_item.get("stderr").and_then(|v| v.as_array()) {
                            for err_entry in stderr_arr {
                                let message = if let Some(s) = err_entry.as_str() {
                                    s.to_string()
                                } else {
                                    err_entry.to_string()
                                };
                                if !message.is_empty() {
                                    all_logs.push(CapturedLogEntry {
                                        timestamp: None,
                                        level: "error".to_string(),
                                        message,
                                    });
                                }
                            }
                        }
                    }
                }

                let logs = if all_logs.is_empty() {
                    None
                } else {
                    Some(all_logs)
                };

                // Debug: log when we find logs for a tool execution
                if logs.is_some() {
                    log::debug!(
                        "[pool-logs] Found {} logs for tool: {}",
                        logs.as_ref().map(|l| l.len()).unwrap_or(0),
                        tool_name
                    );
                }

                executions.push(StandaloneToolExecution {
                    id,
                    tool_name,
                    arguments: request,
                    result,
                    error: error.clone(),
                    duration_ms,
                    succeeded: status == "success" && error.is_none(),
                    timestamp,
                    file_path: path.to_string_lossy().to_string(),
                    definition,
                    logs,
                });
            }
        }
    }

    log::info!("[TOOL-HISTORY] Returning {} executions", executions.len());
    Ok(executions)
}

/// Event emitted when a workflow file changes
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowFileChangedEvent {
    pub workflow_id: String,
    pub changed_path: String,
    pub event_type: String,
}

/// Start watching a workflow directory for file changes
#[tauri::command]
#[specta::specta]
pub fn start_workflow_watcher(app: tauri::AppHandle, workflow_id: String) -> Result<(), String> {
    use std::env;
    use std::path::PathBuf;

    // Get workflow directory path
    let workflows_dir = if cfg!(target_os = "windows") {
        let local_app_data =
            env::var("LOCALAPPDATA").unwrap_or_else(|_| env::var("APPDATA").unwrap_or_else(|_| ".".to_string()));
        PathBuf::from(local_app_data)
            .join("mediar")
            .join("workflows")
    } else if cfg!(target_os = "macos") {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("mediar")
            .join("workflows")
    } else {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("mediar")
            .join("workflows")
    };

    // Use find_workflow_path_by_uuid to resolve actual folder (may differ from UUID)
    let workflow_path = find_workflow_path_by_uuid(&workflows_dir, &workflow_id)
        .ok_or_else(|| format!("Workflow not found for ID: {}", workflow_id))?;

    info!(
        "[FILE_WATCHER] Resolved workflow {} to path: {:?}",
        workflow_id, workflow_path
    );

    // Stop any existing watcher for this workflow
    {
        let mut watchers = WORKFLOW_WATCHERS.lock().map_err(|e| e.to_string())?;
        watchers.remove(&workflow_id);
    }

    let wf_id = workflow_id.clone();
    let wf_path = workflow_path.clone();
    let app_handle = app.clone();

    // Create debounced watcher - waits 1 second after last change before emitting
    let mut debouncer = new_debouncer(Duration::from_secs(1), move |res: DebounceEventResult| {
        match res {
            Ok(events) => {
                for event in events {
                    // Convert to relative path from workflow root for consistent path handling
                    let changed_path = event
                        .path
                        .strip_prefix(&wf_path)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| event.path.to_string_lossy().to_string());

                    // Skip if no path (shouldn't happen but be safe)
                    if changed_path.is_empty() {
                        continue;
                    }

                    // Skip node_modules directory
                    if changed_path.contains("node_modules") {
                        continue;
                    }

                    // Skip paths that are being written by undo/redo operations
                    {
                        let mut skip_paths = SKIP_WATCHER_PATHS.lock().unwrap();
                        if skip_paths.remove(&changed_path) {
                            debug!(
                                "⏭️ [FILE_WATCHER] Skipping undo/redo path: {}",
                                changed_path
                            );
                            continue;
                        }
                    }

                    let event_type = format!("{:?}", event.kind);

                    // Get the filename for logging
                    let filename = event
                        .path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "unknown".to_string());

                    info!(
                        "📝 [FILE_WATCHER] {} changed: {:?} (debounced) path={}",
                        filename, event.kind, changed_path
                    );

                    let payload = WorkflowFileChangedEvent {
                        workflow_id: wf_id.clone(),
                        changed_path,
                        event_type,
                    };

                    if let Err(e) = app_handle.emit("workflow-file-changed", payload) {
                        error!("Failed to emit workflow-file-changed event: {}", e);
                    }
                }
            }
            Err(e) => {
                error!("File watcher error: {:?}", e);
            }
        }
    })
    .map_err(|e| format!("Failed to create debouncer: {}", e))?;

    // Start watching
    debouncer
        .watcher()
        .watch(&workflow_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to start watching: {}", e))?;

    // Store the debouncer
    {
        let mut watchers = WORKFLOW_WATCHERS.lock().map_err(|e| e.to_string())?;
        watchers.insert(workflow_id.clone(), debouncer);
    }

    info!(
        "✅ [FILE_WATCHER] Started watching workflow: {} at {:?}",
        workflow_id, workflow_path
    );
    Ok(())
}

/// Stop watching a workflow directory
#[tauri::command]
#[specta::specta]
pub fn stop_workflow_watcher(workflow_id: String) -> Result<(), String> {
    let mut watchers = WORKFLOW_WATCHERS.lock().map_err(|e| e.to_string())?;

    if watchers.remove(&workflow_id).is_some() {
        info!(
            "🛑 [FILE_WATCHER] Stopped watching workflow: {}",
            workflow_id
        );
    }

    Ok(())
}

// ============================================================================
// Edit History Commands
// ============================================================================

/// State of edit history for a workflow
#[derive(Debug, Serialize, specta::Type)]
pub struct EditHistoryState {
    pub can_undo: bool,
    pub can_redo: bool,
    pub history_count: usize,
    pub current_index: i32,
}

/// Result of undo/redo operation (mirrors edit_history::RestoreResult)
#[derive(Debug, Serialize, specta::Type)]
pub struct UndoRedoResult {
    pub success: bool,
    pub error: Option<String>,
    pub restored_files: Vec<RestoredFileInfo>,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Info about a restored file (mirrors edit_history::RestoredFile)
#[derive(Debug, Serialize, specta::Type)]
pub struct RestoredFileInfo {
    pub path: String,
    pub content: String,
    /// The content before the restore operation - for merge view diff display
    pub original_content: String,
}

impl From<RestoredFile> for RestoredFileInfo {
    fn from(rf: RestoredFile) -> Self {
        Self {
            path: rf.path,
            content: rf.content,
            original_content: rf.original_content,
        }
    }
}

impl From<RestoreResult> for UndoRedoResult {
    fn from(rr: RestoreResult) -> Self {
        Self {
            success: rr.success,
            error: rr.error,
            restored_files: rr.restored_files.into_iter().map(|rf| rf.into()).collect(),
            can_undo: rr.can_undo,
            can_redo: rr.can_redo,
        }
    }
}

/// Initialize edit history for a workflow - runs blocking I/O on a separate thread
/// Should be called when a workflow is opened
#[tauri::command]
#[specta::specta]
pub async fn init_edit_history(workflow_id: String) -> Result<EditHistoryState, String> {
    tokio::task::spawn_blocking(move || {
        let workflows_dir = get_workflows_directory_sync()?;
        let workflows_path = PathBuf::from(&workflows_dir);
        let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
            .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

        let mut histories = EDIT_HISTORIES.lock().map_err(|e| e.to_string())?;

        // Create or get existing history
        let history = if histories.contains_key(&workflow_id) {
            histories.get(&workflow_id).unwrap()
        } else {
            let new_history = EditHistory::new(&workflow_id, &workflow_path)?;
            histories.insert(workflow_id.clone(), new_history);
            histories.get(&workflow_id).unwrap()
        };

        let (can_undo, can_redo, history_count, current_index) = history.get_state();

        info!(
            "📜 [EDIT_HISTORY] Initialized for {}: can_undo={}, can_redo={}, count={}",
            workflow_id, can_undo, can_redo, history_count
        );

        Ok(EditHistoryState {
            can_undo,
            can_redo,
            history_count,
            current_index,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Record a file edit (batch of changes from file watcher)
/// Record a file edit - runs blocking I/O on a separate thread to prevent UI freezes
#[tauri::command]
#[specta::specta]
pub async fn record_file_edit(workflow_id: String, changes: Vec<FileEditChange>) -> Result<EditHistoryState, String> {
    info!(
        "📝 [EDIT_HISTORY] record_file_edit called for {} with {} changes",
        workflow_id,
        changes.len()
    );

    // Run the blocking operation on a separate thread pool to avoid blocking the main thread
    // This prevents UI freezes when file I/O is slow (antivirus, disk busy, etc.)
    tokio::task::spawn_blocking(move || {
        // Wrap in catch_unwind to prevent panics from crashing the app
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            record_file_edit_inner(workflow_id, changes)
        }));

        match result {
            Ok(inner_result) => inner_result,
            Err(panic_info) => {
                let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "Unknown panic".to_string()
                };
                error!("❌ [EDIT_HISTORY] PANIC in record_file_edit: {}", panic_msg);
                Err(format!("Internal error (panic): {}", panic_msg))
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Inner implementation of record_file_edit (can panic safely)
fn record_file_edit_inner(workflow_id: String, changes: Vec<FileEditChange>) -> Result<EditHistoryState, String> {
    let mut histories = EDIT_HISTORIES.lock().map_err(|e| {
        error!("❌ [EDIT_HISTORY] Failed to acquire lock: {}", e);
        e.to_string()
    })?;
    info!("📝 [EDIT_HISTORY] Acquired EDIT_HISTORIES lock");

    let history = histories.get_mut(&workflow_id).ok_or_else(|| {
        let err = format!("Edit history not initialized for workflow: {}", workflow_id);
        error!("❌ [EDIT_HISTORY] {}", err);
        err
    })?;
    info!("📝 [EDIT_HISTORY] Found history entry for workflow");

    // Convert to the format expected by EditHistory
    let edit_changes: Vec<(String, String, String)> = changes
        .into_iter()
        .map(|c| (c.path, c.before_content, c.after_content))
        .collect();
    info!("📝 [EDIT_HISTORY] Converted {} changes", edit_changes.len());

    history.record_edit(edit_changes)?;
    info!("📝 [EDIT_HISTORY] Successfully recorded edit");

    let (can_undo, can_redo, history_count, current_index) = history.get_state();
    info!(
        "📝 [EDIT_HISTORY] State: can_undo={}, can_redo={}, count={}",
        can_undo, can_redo, history_count
    );

    Ok(EditHistoryState {
        can_undo,
        can_redo,
        history_count,
        current_index,
    })
}

/// A single file change for recording
#[derive(Debug, Deserialize, specta::Type)]
pub struct FileEditChange {
    pub path: String,
    pub before_content: String,
    pub after_content: String,
}

/// Undo the last file edit - runs blocking I/O on a separate thread to prevent UI freezes
#[tauri::command]
#[specta::specta]
pub async fn undo_file_edit(workflow_id: String) -> Result<UndoRedoResult, String> {
    tokio::task::spawn_blocking(move || {
        let _workflows_dir = get_workflows_directory_sync()?;

        let mut histories = EDIT_HISTORIES.lock().map_err(|e| e.to_string())?;

        let history = histories
            .get_mut(&workflow_id)
            .ok_or_else(|| format!("Edit history not initialized for workflow: {}", workflow_id))?;

        // Get the files that will be restored before the undo
        // We need to add them to skip list before writing
        if history.can_undo() {
            let skip_paths = SKIP_WATCHER_PATHS.lock().map_err(|e| e.to_string())?;
            // We'll add specific paths after we know what will be restored
            // For now, get the entry we're about to undo
            let (can_undo, _, _, current_index) = history.get_state();
            if can_undo && current_index >= 0 {
                // Preview what paths will be changed
                // Note: We'll populate this from the result
            }
            drop(skip_paths);
        }

        let result = history.undo()?;

        // Add restored file paths to skip list (using relative paths to match watcher events)
        if result.success {
            let mut skip_paths = SKIP_WATCHER_PATHS.lock().map_err(|e| e.to_string())?;
            for file in &result.restored_files {
                // Use relative path (same format as watcher emits)
                skip_paths.insert(file.path.clone());
                // Also try with backslashes for Windows
                skip_paths.insert(file.path.replace('/', "\\"));
            }
        }

        info!(
            "⏪ [EDIT_HISTORY] Undo for {}: success={}, files={}",
            workflow_id,
            result.success,
            result.restored_files.len()
        );

        Ok(result.into())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Redo the last undone file edit - runs blocking I/O on a separate thread to prevent UI freezes
#[tauri::command]
#[specta::specta]
pub async fn redo_file_edit(workflow_id: String) -> Result<UndoRedoResult, String> {
    tokio::task::spawn_blocking(move || {
        let _workflows_dir = get_workflows_directory_sync()?;

        let mut histories = EDIT_HISTORIES.lock().map_err(|e| e.to_string())?;

        let history = histories
            .get_mut(&workflow_id)
            .ok_or_else(|| format!("Edit history not initialized for workflow: {}", workflow_id))?;

        let result = history.redo()?;

        // Add restored file paths to skip list (using relative paths to match watcher events)
        if result.success {
            let mut skip_paths = SKIP_WATCHER_PATHS.lock().map_err(|e| e.to_string())?;
            for file in &result.restored_files {
                // Use relative path (same format as watcher emits)
                skip_paths.insert(file.path.clone());
                // Also try with backslashes for Windows
                skip_paths.insert(file.path.replace('/', "\\"));
            }
        }

        info!(
            "⏩ [EDIT_HISTORY] Redo for {}: success={}, files={}",
            workflow_id,
            result.success,
            result.restored_files.len()
        );

        Ok(result.into())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Get current edit history state - runs on separate thread to avoid blocking UI
#[tauri::command]
#[specta::specta]
pub async fn get_edit_history_state(workflow_id: String) -> Result<EditHistoryState, String> {
    tokio::task::spawn_blocking(move || {
        let histories = EDIT_HISTORIES.lock().map_err(|e| e.to_string())?;

        let history = histories
            .get(&workflow_id)
            .ok_or_else(|| format!("Edit history not initialized for workflow: {}", workflow_id))?;

        let (can_undo, can_redo, history_count, current_index) = history.get_state();

        Ok(EditHistoryState {
            can_undo,
            can_redo,
            history_count,
            current_index,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Capture baseline file contents for edit history - runs blocking I/O on a separate thread
/// Called when workflow is first loaded to establish initial state
#[tauri::command]
#[specta::specta]
pub async fn capture_edit_history_baseline(workflow_id: String, files: Vec<BaselineFile>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut histories = EDIT_HISTORIES.lock().map_err(|e| e.to_string())?;

        let history = histories
            .get_mut(&workflow_id)
            .ok_or_else(|| format!("Edit history not initialized for workflow: {}", workflow_id))?;

        let baseline: Vec<(String, String)> = files.into_iter().map(|f| (f.path, f.content)).collect();

        history.capture_baseline(baseline)?;

        info!("📸 [EDIT_HISTORY] Captured baseline for {}", workflow_id);

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// A file for baseline capture
#[derive(Debug, Deserialize, specta::Type)]
pub struct BaselineFile {
    pub path: String,
    pub content: String,
}

/// Result of computing a file diff
#[derive(Debug, Serialize, specta::Type)]
pub struct FileDiffResult {
    pub added_lines: Vec<usize>,
    pub removed_lines: Vec<usize>,
}

/// Compute line-level diff between old and new content
/// Returns line numbers (1-indexed) that were added or removed
#[tauri::command]
#[specta::specta]
pub fn compute_file_diff(old_content: String, new_content: String) -> Result<FileDiffResult, String> {
    info!(
        "🔍 [DIFF] compute_file_diff called: old={} bytes, new={} bytes",
        old_content.len(),
        new_content.len()
    );

    // Wrap in catch_unwind to prevent panics from crashing the app
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::edit_history::compute_line_diff(&old_content, &new_content)
    }));

    match result {
        Ok((added_lines, removed_lines)) => {
            info!(
                "🔍 [DIFF] Diff result: +{} -{} lines",
                added_lines.len(),
                removed_lines.len()
            );
            Ok(FileDiffResult {
                added_lines,
                removed_lines,
            })
        }
        Err(panic_info) => {
            let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic".to_string()
            };
            error!("❌ [DIFF] PANIC in compute_file_diff: {}", panic_msg);
            Err(format!(
                "Internal error computing diff (panic): {}",
                panic_msg
            ))
        }
    }
}

/// Step info for computing affected steps
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StepLineInfo {
    pub id: String,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}

/// Result from computing affected steps - includes changed line range for scrolling
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AffectedStepsResult {
    pub step_ids: Vec<String>,
    pub change_start: Option<usize>,
    pub change_end: Option<usize>,
}

/// Compute which steps are affected by a file change based on line ranges
/// Returns step IDs whose line ranges overlap with changed lines, plus the changed line range
#[tauri::command]
#[specta::specta]
pub fn compute_affected_steps(
    old_content: String,
    new_content: String,
    steps: Vec<StepLineInfo>,
) -> Result<AffectedStepsResult, String> {
    info!(
        "[AFFECTED_STEPS] compute_affected_steps: old={} bytes, new={} bytes, {} steps",
        old_content.len(),
        new_content.len(),
        steps.len()
    );

    // Get changed lines using existing diff function
    let (added_lines, removed_lines) = crate::edit_history::compute_line_diff(&old_content, &new_content);

    // Combine added and removed lines to get all affected line numbers
    let mut changed_lines: std::collections::HashSet<usize> = std::collections::HashSet::new();
    changed_lines.extend(&added_lines);
    changed_lines.extend(&removed_lines);

    if changed_lines.is_empty() {
        info!("[AFFECTED_STEPS] No line changes detected");
        return Ok(AffectedStepsResult {
            step_ids: vec![],
            change_start: None,
            change_end: None,
        });
    }

    // Find the range of changed lines (min to max)
    let change_start = *changed_lines.iter().min().unwrap_or(&0);
    let change_end = *changed_lines.iter().max().unwrap_or(&0);

    info!(
        "[AFFECTED_STEPS] Changed line range: {}-{} ({} unique lines)",
        change_start,
        change_end,
        changed_lines.len()
    );

    // Find steps whose line ranges overlap with changed lines
    let mut affected_ids: Vec<String> = Vec::new();

    for step in &steps {
        let step_start = step.line_start.unwrap_or(0);
        let step_end = step.line_end.unwrap_or(usize::MAX);

        // Ranges overlap if: step_start <= change_end AND change_start <= step_end
        if step_start <= change_end && change_start <= step_end {
            info!(
                "[AFFECTED_STEPS] Step {} (lines {}-{}) overlaps with changes",
                step.id, step_start, step_end
            );
            affected_ids.push(step.id.clone());
        }
    }

    info!(
        "[AFFECTED_STEPS] Result: {} affected steps: {:?}, lines {}-{}",
        affected_ids.len(),
        affected_ids,
        change_start,
        change_end
    );

    Ok(AffectedStepsResult {
        step_ids: affected_ids,
        change_start: Some(change_start),
        change_end: Some(change_end),
    })
}
