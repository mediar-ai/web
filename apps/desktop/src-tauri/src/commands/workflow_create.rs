//! Workflow creation commands using the Terminator CLI
//!
//! This module handles creating new TypeScript workflows by delegating to
//! `terminator init` which has the canonical, up-to-date templates.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::process::Command;
use tracing::{info, error};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

use super::workflows::{find_bundled_bun, get_workflows_directory_sync, SyncMetadata};

/// Check if a command exists in PATH
fn command_exists(cmd: &str) -> bool {
    #[cfg(windows)]
    {
        Command::new("where")
            .arg(cmd)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Input for creating a new TypeScript workflow
#[derive(Debug, Deserialize, Type)]
pub struct CreateTypescriptWorkflowInput {
    pub name: String,
    pub description: Option<String>,
}

/// Result of creating a new TypeScript workflow
#[derive(Debug, Serialize, Type)]
pub struct CreateTypescriptWorkflowResult {
    pub id: String,   // UUID for cloud sync
    pub path: String, // Full path to workflow folder
    pub name: String, // Display name
}

/// Create a new TypeScript workflow using the Terminator CLI
///
/// This delegates to `terminator init` (via bun/npx) which has the canonical
/// workflow templates. This ensures new workflows always use the latest SDK
/// patterns and file structure.
#[tauri::command]
#[specta::specta]
pub async fn create_typescript_workflow(
    input: CreateTypescriptWorkflowInput,
) -> Result<CreateTypescriptWorkflowResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Use UUID as folder name (ensures uniqueness and matches ID for path construction)
    let folder_name = uuid::Uuid::new_v4().to_string();
    let workflow_path = workflows_path.join(&folder_name);

    info!(
        "📁 Creating workflow '{}' at {}",
        input.name,
        workflow_path.display()
    );

    // Run terminator init via bun or npx
    let init_result = run_terminator_init(&folder_name, &workflows_dir).await?;

    if !init_result.success {
        return Err(format!(
            "terminator init failed: {}",
            init_result.stderr.unwrap_or_default()
        ));
    }

    // Update package.json with the user's display name and description
    update_package_json(&workflow_path, &input.name, input.description.as_deref())?;

    // Write sync.json with the folder UUID (ensures folder name = id)
    write_sync_uuid(&workflow_path, &folder_name)?;

    info!(
        "✅ Created TypeScript workflow: {} at {} (id: {})",
        input.name,
        workflow_path.display(),
        folder_name
    );

    Ok(CreateTypescriptWorkflowResult {
        id: folder_name,
        path: workflow_path.to_string_lossy().to_string(),
        name: input.name,
    })
}

struct InitResult {
    success: bool,
    stderr: Option<String>,
}

/// Run `terminator init <name>` in the workflows directory
async fn run_terminator_init(folder_name: &str, working_dir: &str) -> Result<InitResult, String> {
    // Try bundled bun first, then system bun, then npx
    let (cmd, args) = if let Some(bun_path) = find_bundled_bun() {
        (
            bun_path.to_string_lossy().to_string(),
            vec![
                "x".to_string(),
                "@mediar-ai/cli@latest".to_string(),
                "init".to_string(),
                folder_name.to_string(),
                "--skip-install".to_string(), // We'll install deps separately if needed
            ],
        )
    } else if command_exists("bun") {
        (
            "bun".to_string(),
            vec![
                "x".to_string(),
                "@mediar-ai/cli@latest".to_string(),
                "init".to_string(),
                folder_name.to_string(),
                "--skip-install".to_string(),
            ],
        )
    } else if command_exists("npx") {
        (
            "npx".to_string(),
            vec![
                "-y".to_string(),
                "@mediar-ai/cli@latest".to_string(),
                "init".to_string(),
                folder_name.to_string(),
                "--skip-install".to_string(),
            ],
        )
    } else {
        return Err("Neither bun nor npx found. Please install Node.js or Bun to create workflows.".to_string());
    };

    info!("🚀 Running: {} {:?} in {}", cmd, args, working_dir);

    let mut command = Command::new(&cmd);
    command.args(&args).current_dir(working_dir);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|e| format!("Failed to run terminator init: {}", e))?;

    let success = output.status.success();
    let stderr = if output.stderr.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&output.stderr).to_string())
    };

    if !success {
        info!(
            "❌ terminator init failed: {}",
            stderr.as_deref().unwrap_or("unknown error")
        );
    } else {
        info!("✅ terminator init completed successfully");
    }

    Ok(InitResult { success, stderr })
}

/// Update package.json with the user's display name and description
fn update_package_json(workflow_path: &PathBuf, display_name: &str, description: Option<&str>) -> Result<(), String> {
    let package_json_path = workflow_path.join("package.json");

    if !package_json_path.exists() {
        return Err("package.json not found after init".to_string());
    }

    let content =
        std::fs::read_to_string(&package_json_path).map_err(|e| format!("Failed to read package.json: {}", e))?;

    let mut package: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse package.json: {}", e))?;

    // Set name directly - all workflows use readable name in this field
    if let Some(obj) = package.as_object_mut() {
        obj.insert(
            "name".to_string(),
            serde_json::Value::String(display_name.to_string()),
        );

        // Update description if provided
        if let Some(desc) = description {
            obj.insert(
                "description".to_string(),
                serde_json::Value::String(desc.to_string()),
            );
        }
    }

    let updated_content =
        serde_json::to_string_pretty(&package).map_err(|e| format!("Failed to serialize package.json: {}", e))?;

    std::fs::write(&package_json_path, updated_content).map_err(|e| format!("Failed to write package.json: {}", e))?;

    Ok(())
}

/// Get or create the cloud UUID from .mediar/sync.json
fn get_or_create_cloud_uuid(workflow_path: &PathBuf) -> Result<String, String> {
    let mediar_dir = workflow_path.join(".mediar");
    let sync_path = mediar_dir.join("sync.json");

    // If sync.json exists, read the UUID
    if sync_path.exists() {
        let content = std::fs::read_to_string(&sync_path).map_err(|e| format!("Failed to read sync.json: {}", e))?;

        let sync_data: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse sync.json: {}", e))?;

        if let Some(uuid) = sync_data
            .get("cloud_workflow_uuid")
            .and_then(|v| v.as_str())
        {
            return Ok(uuid.to_string());
        }
    }

    // Create .mediar directory if needed
    if !mediar_dir.exists() {
        std::fs::create_dir_all(&mediar_dir).map_err(|e| format!("Failed to create .mediar directory: {}", e))?;

        // Make it hidden on Windows
        #[cfg(windows)]
        {
            let _ = Command::new("attrib")
                .args(["+H", &mediar_dir.to_string_lossy()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    // Generate new UUID and save
    let cloud_uuid = uuid::Uuid::new_v4().to_string();
    let sync_metadata = SyncMetadata {
        last_synced_at: None,
        cloud_workflow_id: None,
        cloud_version: None,
        cloud_workflow_uuid: Some(cloud_uuid.clone()),
    };

    let sync_json = serde_json::to_string_pretty(&sync_metadata)
        .map_err(|e| format!("Failed to serialize sync metadata: {}", e))?;

    std::fs::write(&sync_path, sync_json).map_err(|e| format!("Failed to write sync.json: {}", e))?;

    Ok(cloud_uuid)
}

/// Write a specific UUID to .mediar/sync.json (used when folder name = UUID)
fn write_sync_uuid(workflow_path: &PathBuf, uuid: &str) -> Result<(), String> {
    let mediar_dir = workflow_path.join(".mediar");
    let sync_path = mediar_dir.join("sync.json");

    // Create .mediar directory if needed
    if !mediar_dir.exists() {
        std::fs::create_dir_all(&mediar_dir).map_err(|e| format!("Failed to create .mediar directory: {}", e))?;

        // Make it hidden on Windows
        #[cfg(windows)]
        {
            let _ = Command::new("attrib")
                .args(["+H", &mediar_dir.to_string_lossy()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    // Write sync.json with the given UUID
    let sync_metadata = SyncMetadata {
        last_synced_at: None,
        cloud_workflow_id: None,
        cloud_version: None,
        cloud_workflow_uuid: Some(uuid.to_string()),
    };

    let sync_json = serde_json::to_string_pretty(&sync_metadata)
        .map_err(|e| format!("Failed to serialize sync metadata: {}", e))?;

    std::fs::write(&sync_path, sync_json).map_err(|e| format!("Failed to write sync.json: {}", e))?;

    Ok(())
}

/// Input for generating TypeScript step from recorded events
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTypescriptStepInput {
    /// The raw recording events as JSON string
    pub events_json: String,
    /// Step ID (will be used as filename and export name)
    pub step_id: String,
    /// Human-readable step name
    pub step_name: String,
}

/// Result of generating TypeScript step
#[derive(Debug, Serialize, Type)]
pub struct GenerateTypescriptStepResult {
    /// The generated TypeScript code
    pub code: String,
    /// Number of events processed
    pub event_count: usize,
    /// Number of actual code lines generated (excluding comments)
    pub action_count: usize,
}

/// Generate TypeScript step code from recorded events
///
/// This takes raw recording events and converts them to TypeScript SDK code
/// using the @mediar-ai/workflow SDK patterns.
#[tauri::command]
#[specta::specta]
pub fn generate_typescript_step(input: GenerateTypescriptStepInput) -> Result<GenerateTypescriptStepResult, String> {
    use crate::mcp_converter::McpConverter;
    use terminator_workflow_recorder::WorkflowEvent;

    info!(
        "[ts_gen] Generating TypeScript step '{}' from events JSON",
        input.step_name
    );

    // Parse the JSON array of events
    info!("[ts_gen] DEBUG generate: events_json length = {}", input.events_json.len());
    if input.events_json.len() > 100 {
        info!("[ts_gen] DEBUG generate: events_json first 100 chars = {:?}", &input.events_json[..100]);
        info!("[ts_gen] DEBUG generate: events_json last 100 chars = {:?}", &input.events_json[input.events_json.len()-100..]);
    } else {
        info!("[ts_gen] DEBUG generate: events_json = {:?}", &input.events_json);
    }
    let events: Vec<WorkflowEvent> = serde_json::from_str(&input.events_json).map_err(|e| {
        error!("[ts_gen] JSON parse error in generate: {}", e);
        if let Some(col) = e.to_string().split("column ").nth(1).and_then(|s| s.parse::<usize>().ok()) {
            let start = col.saturating_sub(50);
            let end = (col + 50).min(input.events_json.len());
            if end > start {
                error!("[ts_gen] JSON context around error: ...{:?}...", &input.events_json[start..end]);
            }
        }
        format!("Failed to parse events JSON: {}", e)
    })?;

    info!("[ts_gen] Parsed {} events from JSON", events.len());

    // Create converter and generate TypeScript step
    let converter = McpConverter::new();
    let code = converter.generate_typescript_step(&events, &input.step_id, &input.step_name);

    // Count actual action lines (non-comment, non-empty)
    let action_count = code
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty()
                && !trimmed.starts_with("//")
                && !trimmed.starts_with("import")
                && !trimmed.starts_with("export")
                && !trimmed.contains("createStep")
                && !trimmed.contains("console.log")
                && !trimmed.starts_with("return")
                && !trimmed.starts_with("{")
                && !trimmed.starts_with("}")
                && !trimmed.starts_with("id:")
                && !trimmed.starts_with("name:")
                && !trimmed.starts_with("execute:")
        })
        .filter(|line| line.contains("await desktop."))
        .count();

    info!(
        "[ts_gen] Generated TypeScript with {} action lines",
        action_count
    );

    Ok(GenerateTypescriptStepResult {
        code,
        event_count: events.len(),
        action_count,
    })
}

/// Input for saving a recorded workflow as TypeScript
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveRecordedTypescriptWorkflowInput {
    /// Workflow name (used for folder name and display)
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// The raw recording events as JSON string
    pub events_json: String,
    /// Optional existing workflow path to update (instead of creating new)
    pub existing_workflow_path: Option<String>,
}

/// Result of saving a recorded TypeScript workflow
#[derive(Debug, Serialize, Type)]
pub struct SaveRecordedTypescriptWorkflowResult {
    /// UUID for cloud sync
    pub id: String,
    /// Full path to workflow folder
    pub path: String,
    /// Display name
    pub name: String,
    /// Number of events processed
    pub event_count: usize,
    /// Number of action lines generated
    pub action_count: usize,
}

/// Info about an existing step file
#[derive(Debug, Clone)]
struct ExistingStepInfo {
    /// Step number (e.g., 1 for 01-recorded-step.ts)
    number: u32,
    /// Step export name (e.g., "recordedStep")
    export_name: String,
    /// File name without path (e.g., "01-recorded-step.ts")
    file_name: String,
}

/// Scan existing step files in src/steps/ directory
fn scan_existing_steps(workflow_path: &PathBuf) -> Vec<ExistingStepInfo> {
    let steps_dir = workflow_path.join("src/steps");
    let mut steps = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&steps_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |e| e == "ts") {
                let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

                // Parse step number from filename (e.g., "01-recorded-step.ts" -> 1)
                if let Some(num_str) = file_name.split('-').next() {
                    if let Ok(number) = num_str.parse::<u32>() {
                        // Try to extract export name from file content
                        let export_name = if let Ok(content) = std::fs::read_to_string(&path) {
                            extract_step_export_name(&content).unwrap_or_else(|| format!("step{}", number))
                        } else {
                            format!("step{}", number)
                        };

                        steps.push(ExistingStepInfo {
                            number,
                            export_name,
                            file_name,
                        });
                    }
                }
            }
        }
    }

    // Sort by step number
    steps.sort_by_key(|s| s.number);
    steps
}

/// Extract the exported step name from a step file's content
/// Looks for pattern: export const stepName = createStep(
fn extract_step_export_name(content: &str) -> Option<String> {
    // Match: export const NAME = createStep
    let re = regex::Regex::new(r"export\s+const\s+(\w+)\s*=\s*createStep").ok()?;
    re.captures(content).map(|c| c[1].to_string())
}

/// Save recorded events as a new TypeScript workflow
///
/// This creates a complete TypeScript workflow folder with:
/// - package.json with workflow metadata
/// - tsconfig.json
/// - src/terminator.ts (main workflow file)
/// - src/steps/01-recorded-step.ts (generated from events)
#[tauri::command]
#[specta::specta]
pub async fn save_recorded_typescript_workflow(
    input: SaveRecordedTypescriptWorkflowInput,
) -> Result<SaveRecordedTypescriptWorkflowResult, String> {
    use crate::mcp_converter::McpConverter;
    use terminator_workflow_recorder::WorkflowEvent;

    info!(
        "[ts_gen] Saving recorded TypeScript workflow: {} (existing_path: {:?})",
        input.name, input.existing_workflow_path
    );

    // Determine workflow path - use existing if provided, otherwise create new
    let (workflow_path, is_update) = if let Some(existing_path) = &input.existing_workflow_path {
        let path = PathBuf::from(existing_path);
        if path.exists() {
            info!("[ts_gen] Updating existing workflow at: {}", path.display());
            (path, true)
        } else {
            info!("[ts_gen] Existing path not found, will create new folder");
            (path, false)
        }
    } else {
        // Create new folder
        let workflows_dir = get_workflows_directory_sync()?;
        let workflows_path = PathBuf::from(&workflows_dir);

        // Sanitize name for folder
        let sanitized_name = input
            .name
            .to_lowercase()
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
            .trim_matches('-')
            .to_string();

        // Handle duplicate folder names
        let mut folder_name = sanitized_name.clone();
        let mut counter = 1;
        while workflows_path.join(&folder_name).exists() {
            counter += 1;
            folder_name = format!("{}-{}", sanitized_name, counter);
        }

        let path = workflows_path.join(&folder_name);
        info!(
            "[ts_gen] Creating new workflow folder at: {}",
            path.display()
        );
        (path, false)
    };

    // Parse the events
    info!("[ts_gen] DEBUG: events_json length = {}", input.events_json.len());
    if input.events_json.len() > 100 {
        info!("[ts_gen] DEBUG: events_json first 100 chars = {:?}", &input.events_json[..100]);
        info!("[ts_gen] DEBUG: events_json last 100 chars = {:?}", &input.events_json[input.events_json.len()-100..]);
    } else {
        info!("[ts_gen] DEBUG: events_json = {:?}", &input.events_json);
    }
    let events: Vec<WorkflowEvent> = serde_json::from_str(&input.events_json).map_err(|e| {
        error!("[ts_gen] JSON parse error: {}", e);
        // Show context around error position
        if let Some(col) = e.to_string().split("column ").nth(1).and_then(|s| s.parse::<usize>().ok()) {
            let start = col.saturating_sub(50);
            let end = (col + 50).min(input.events_json.len());
            if end > start {
                error!("[ts_gen] JSON context around error: ...{:?}...", &input.events_json[start..end]);
            }
        }
        format!("Failed to parse events JSON: {}", e)
    })?;

    info!(
        "[ts_gen] Parsed {} events (is_update: {})",
        events.len(),
        is_update
    );

    // Create directory structure (safe to call even if exists)
    std::fs::create_dir_all(workflow_path.join("src/steps"))
        .map_err(|e| format!("Failed to create directory structure: {}", e))?;

    let converter = McpConverter::new();

    // Determine step number and name based on whether this is an update
    let (_step_number, step_name, step_file_name, existing_steps) = if is_update {
        // Scan existing steps to determine next number
        let existing = scan_existing_steps(&workflow_path);
        let next_number = existing.iter().map(|s| s.number).max().unwrap_or(0) + 1;
        let step_name = if next_number == 1 {
            "recordedStep".to_string()
        } else {
            format!("recordedStep{}", next_number)
        };
        let file_name = format!("{:02}-recorded-step.ts", next_number);
        info!(
            "[ts_gen] Appending step {} (file: {}) to existing workflow with {} steps",
            step_name, file_name, existing.len()
        );
        (next_number, step_name, file_name, existing)
    } else {
        // New workflow - start with step 1
        (1, "recordedStep".to_string(), "01-recorded-step.ts".to_string(), Vec::new())
    };

    // Generate TypeScript step from events with the determined name
    let step_code = converter.generate_typescript_step(&events, &step_name, &input.name);

    // Count action lines
    let action_count = step_code
        .lines()
        .filter(|line| line.contains("await desktop."))
        .count();

    // Get folder name from path (for package.json name field)
    let folder_name = workflow_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workflow");

    // Only write package.json and tsconfig.json for new workflows
    if !is_update {
        // Create package.json
        let package_json = format!(
            r#"{{
  "name": "{}",
  "version": "1.0.0",
  "description": "{}",
  "main": "src/terminator.ts",
  "scripts": {{
    "build": "tsc --noEmit"
  }},
  "dependencies": {{
    "@mediar-ai/workflow": "latest"
  }},
  "devDependencies": {{
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }},
  "terminator": {{
    "displayName": "{}"
  }}
}}"#,
            folder_name,
            input.description.as_deref().unwrap_or("Recorded workflow"),
            input.name
        );

        std::fs::write(workflow_path.join("package.json"), package_json)
            .map_err(|e| format!("Failed to write package.json: {}", e))?;

        // Create tsconfig.json
        let tsconfig = r#"{
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
}"#;

        std::fs::write(workflow_path.join("tsconfig.json"), tsconfig)
            .map_err(|e| format!("Failed to write tsconfig.json: {}", e))?;
    }

    // Build terminator.ts - either fresh for new workflow or with all existing + new step
    let main_workflow = if is_update && !existing_steps.is_empty() {
        // Build imports: existing steps + new step
        let mut all_imports = String::new();
        all_imports.push_str("import { createWorkflow, z } from \"@mediar-ai/workflow\";\n");

        // Add existing step imports
        for step in &existing_steps {
            let file_base = step.file_name.trim_end_matches(".ts");
            all_imports.push_str(&format!(
                "import {{ {} }} from \"./steps/{}\";\n",
                step.export_name, file_base
            ));
        }

        // Add new step import
        let new_file_base = step_file_name.trim_end_matches(".ts");
        all_imports.push_str(&format!(
            "import {{ {} }} from \"./steps/{}\";\n",
            step_name, new_file_base
        ));

        // Build steps array: existing + new
        let mut steps_array = String::new();
        for (i, step) in existing_steps.iter().enumerate() {
            if i > 0 {
                steps_array.push_str(",\n    ");
            }
            steps_array.push_str(&step.export_name);
        }
        if !existing_steps.is_empty() {
            steps_array.push_str(",\n    ");
        }
        steps_array.push_str(&step_name);

        format!(
            r#"{}
export default createWorkflow({{
  // Recorded workflow: {}
  input: z.object({{}}).optional(),
  trigger: {{
    type: 'manual',
  }},
  steps: [
    {},
  ],
  onSuccess: async ({{ context }}: {{ context: {{ data: Record<string, unknown> }} }}) => {{
    context.data = {{ success: true }};
  }},
  onError: async ({{ error }}: {{ error: Error }}) => {{
    console.error("Workflow failed:", error.message);
  }},
}});
"#,
            all_imports, input.name, steps_array
        )
    } else {
        // New workflow - single step
        format!(
            r#"import {{ createWorkflow, z }} from "@mediar-ai/workflow";
import {{ {} }} from "./steps/{}";

export default createWorkflow({{
  // Recorded workflow: {}
  input: z.object({{}}).optional(),
  trigger: {{
    type: 'manual',
  }},
  steps: [
    {},
  ],
  onSuccess: async ({{ context }}: {{ context: {{ data: Record<string, unknown> }} }}) => {{
    context.data = {{ success: true }};
  }},
  onError: async ({{ error }}: {{ error: Error }}) => {{
    console.error("Workflow failed:", error.message);
  }},
}});
"#,
            step_name,
            step_file_name.trim_end_matches(".ts"),
            input.name,
            step_name
        )
    };

    std::fs::write(workflow_path.join("src/terminator.ts"), main_workflow)
        .map_err(|e| format!("Failed to write src/terminator.ts: {}", e))?;

    // Write the new recorded step
    std::fs::write(
        workflow_path.join(format!("src/steps/{}", step_file_name)),
        &step_code,
    )
    .map_err(|e| format!("Failed to write step file: {}", e))?;

    info!(
        "[ts_gen] Wrote step file: {} with {} action lines",
        step_file_name, action_count
    );

    // Create .gitignore
    let gitignore = "node_modules/\ndist/\n*.log\n.DS_Store\n";
    std::fs::write(workflow_path.join(".gitignore"), gitignore)
        .map_err(|e| format!("Failed to write .gitignore: {}", e))?;

    // Get or create cloud UUID
    let cloud_uuid = get_or_create_cloud_uuid(&workflow_path)?;

    info!(
        "[ts_gen] Created TypeScript workflow: {} at {} (cloud_uuid: {})",
        input.name,
        workflow_path.display(),
        cloud_uuid
    );

    Ok(SaveRecordedTypescriptWorkflowResult {
        id: cloud_uuid,
        path: workflow_path.to_string_lossy().to_string(),
        name: input.name,
        event_count: events.len(),
        action_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_name() {
        let input = "My Cool Workflow!";
        let sanitized = input
            .to_lowercase()
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
            .trim_matches('-')
            .to_string();
        assert_eq!(sanitized, "my-cool-workflow");
    }
}
