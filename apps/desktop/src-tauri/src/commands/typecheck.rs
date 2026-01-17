//! TypeScript type checking for workflows
//!
//! Runs `tsc --noEmit` on workflow TypeScript files and parses the output
//! to provide structured error information.

use log::{error, info};
use regex::Regex;
use serde::Serialize;
use std::path::PathBuf;

use super::workflows::{find_bundled_bun, get_workflows_directory_sync};

/// Create a Command that hides the console window on Windows
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

/// Result of TypeScript type checking
#[derive(Debug, Serialize, specta::Type)]
pub struct TypecheckResult {
    /// Whether the typecheck passed (no errors)
    pub success: bool,
    /// Number of errors found
    pub error_count: usize,
    /// Parsed error details
    pub errors: Vec<TypecheckError>,
    /// Raw output from tsc
    pub raw_output: String,
}

/// A single TypeScript error with code context
#[derive(Debug, Serialize, specta::Type)]
pub struct TypecheckError {
    /// File path (relative to workflow)
    pub file: String,
    /// Line number (1-indexed)
    pub line: usize,
    /// Column number (1-indexed)
    pub column: usize,
    /// Error code (e.g., "TS2304")
    pub code: String,
    /// Error message
    pub message: String,
    /// Code context: ~5 lines around the error with line numbers
    pub context: Option<String>,
}

/// Parse TypeScript compiler errors from tsc output
/// Format: "src/terminator.ts(10,5): error TS2304: Cannot find name 'foo'."
fn parse_tsc_errors(output: &str) -> Vec<TypecheckError> {
    let mut errors = Vec::new();

    // Regex pattern for tsc error format: file(line,col): error TSxxxx: message
    let error_pattern = Regex::new(r"^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$").ok();

    if let Some(re) = error_pattern {
        for line in output.lines() {
            if let Some(caps) = re.captures(line.trim()) {
                errors.push(TypecheckError {
                    file: caps
                        .get(1)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default(),
                    line: caps
                        .get(2)
                        .and_then(|m| m.as_str().parse().ok())
                        .unwrap_or(0),
                    column: caps
                        .get(3)
                        .and_then(|m| m.as_str().parse().ok())
                        .unwrap_or(0),
                    code: caps
                        .get(4)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default(),
                    message: caps
                        .get(5)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default(),
                    context: None, // Will be enriched later
                });
            }
        }
    }

    errors
}

/// Extract code context around an error (5 lines before/after)
/// Returns formatted string with line numbers and arrow pointing to error
fn get_error_context(workflow_path: &std::path::Path, error: &TypecheckError) -> Option<String> {
    use std::fs;

    let file_path = workflow_path.join(&error.file);
    let content = fs::read_to_string(&file_path).ok()?;
    let lines: Vec<&str> = content.lines().collect();

    if error.line == 0 || error.line > lines.len() {
        return None;
    }

    let error_idx = error.line - 1; // Convert to 0-indexed
    let start = error_idx.saturating_sub(3);
    let end = (error_idx + 4).min(lines.len());

    let mut context_lines = Vec::new();
    for i in start..end {
        let line_num = i + 1;
        let marker = if line_num == error.line {
            " → "
        } else {
            "   "
        };
        context_lines.push(format!("{}{:>4}: {}", marker, line_num, lines[i]));
    }

    Some(context_lines.join("\n"))
}

/// Enrich parsed errors with code context from source files
fn enrich_errors_with_context(workflow_path: &std::path::Path, errors: &mut [TypecheckError]) {
    for error in errors.iter_mut() {
        error.context = get_error_context(workflow_path, error);
    }
}

/// Find workflow folder path by UUID (imported from workflows.rs)
fn find_workflow_path_by_uuid(workflows_dir: &std::path::Path, uuid: &str) -> Option<PathBuf> {
    use std::fs;

    // sync.json is the source of truth for workflow identity
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

    // Fallback: check if folder with UUID name exists
    let direct_path = workflows_dir.join(uuid);
    if direct_path.exists() && direct_path.is_dir() {
        return Some(direct_path);
    }

    None
}

/// Run TypeScript type checking on a workflow
///
/// Runs `bun run build` (which executes `tsc --noEmit` per package.json) and returns
/// structured error information. This allows the AI to verify TypeScript compiles
/// before asking the user to test.
#[tauri::command]
#[specta::specta]
pub async fn typecheck_typescript_workflow(workflow_id: String) -> Result<TypecheckResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    // Find workflow by UUID
    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    info!("🔍 Type checking workflow: {}", workflow_id);

    // Check if tsconfig.json exists
    let tsconfig_path = workflow_path.join("tsconfig.json");
    if !tsconfig_path.exists() {
        return Err("No tsconfig.json found in workflow".to_string());
    }

    // Build the command: prefer bundled bun, then system bun, fallback to npx tsc
    let output = if let Some(bundled_bun) = find_bundled_bun() {
        create_hidden_command(&bundled_bun.to_string_lossy())
            .args(["run", "build"])
            .current_dir(&workflow_path)
            .output()
    } else if create_hidden_command("bun")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        create_hidden_command("bun")
            .args(["run", "build"])
            .current_dir(&workflow_path)
            .output()
    } else {
        // Fallback to npx tsc
        create_hidden_command("npx")
            .args(["tsc", "--noEmit"])
            .current_dir(&workflow_path)
            .output()
    };

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            // Combine stdout and stderr for parsing (tsc outputs to stdout)
            let combined_output = format!("{}\n{}", stdout, stderr);

            if output.status.success() {
                info!("✅ TypeScript check passed for workflow: {}", workflow_id);
                Ok(TypecheckResult {
                    success: true,
                    error_count: 0,
                    errors: vec![],
                    raw_output: combined_output,
                })
            } else {
                let mut errors = parse_tsc_errors(&combined_output);
                let error_count = errors.len();

                // Enrich errors with code context from source files
                enrich_errors_with_context(&workflow_path, &mut errors);

                info!(
                    "❌ TypeScript check failed for workflow: {} ({} errors)",
                    workflow_id, error_count
                );

                Ok(TypecheckResult {
                    success: false,
                    error_count,
                    errors,
                    raw_output: combined_output,
                })
            }
        }
        Err(e) => {
            error!("❌ Failed to run TypeScript check: {}", e);
            Err(format!("Failed to run TypeScript check: {}", e))
        }
    }
}

/// Result of SDK documentation search
#[derive(Debug, Serialize, specta::Type)]
pub struct SdkDocsResult {
    /// Whether any matches were found
    pub found: bool,
    /// Matching code snippets
    pub matches: Vec<SdkDocsMatch>,
    /// Summary message
    pub message: String,
}

/// A single SDK documentation match
#[derive(Debug, Serialize, specta::Type)]
pub struct SdkDocsMatch {
    /// Source file (relative path)
    pub file: String,
    /// Matching code content
    pub content: String,
    /// Starting line number
    pub line_start: usize,
    /// Ending line number
    pub line_end: usize,
}

/// Match priority for sorting results (lower = higher priority)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MatchPriority {
    /// Exact function/export definition (highest priority)
    ExactDefinition = 0,
    /// Interface/type definition
    TypeDefinition = 1,
    /// Doc comment containing query
    DocComment = 2,
    /// General reference (lowest priority)
    Reference = 3,
}

/// Scored match for sorting
struct ScoredMatch {
    sdk_match: SdkDocsMatch,
    priority: MatchPriority,
    exact_name: bool,
}

/// Search @mediar-ai/workflow SDK documentation for function signatures and types
///
/// Searches SDK source files with smart prioritization:
/// 1. Exact function/export definitions (e.g., "export function createWorkflow")
/// 2. Interface/type definitions (e.g., "export interface StepConfig")
/// 3. Doc comments containing the query
/// 4. General references
#[tauri::command]
#[specta::specta]
pub async fn search_sdk_docs(query: String) -> Result<SdkDocsResult, String> {
    use std::fs;

    info!("🔍 Searching SDK docs for: {}", query);

    // Get terminator source directory (where SDK source lives)
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let sdk_src_path = home
        .join("Documents")
        .join("terminator")
        .join("packages")
        .join("workflow")
        .join("src");

    if !sdk_src_path.exists() {
        return Err(format!(
            "SDK source not found at: {}",
            sdk_src_path.display()
        ));
    }

    let query_lower = query.to_lowercase();
    let mut scored_matches: Vec<ScoredMatch> = Vec::new();

    // SDK files to search - prioritize based on query
    let sdk_files: Vec<&str> = if query_lower.contains("createworkflow") || query_lower.contains("create_workflow") {
        // For createWorkflow, search workflow.ts first (has the function def)
        vec![
            "workflow.ts",
            "types.ts",
            "step.ts",
            "runner.ts",
            "index.ts",
        ]
    } else if query_lower.contains("createstep") || query_lower.contains("create_step") {
        // For createStep, search step.ts first
        vec![
            "step.ts",
            "types.ts",
            "workflow.ts",
            "runner.ts",
            "index.ts",
        ]
    } else {
        // Default: types.ts first for interface queries
        vec![
            "types.ts",
            "workflow.ts",
            "step.ts",
            "runner.ts",
            "index.ts",
        ]
    };

    for file_name in &sdk_files {
        let file_path = sdk_src_path.join(file_name);
        if !file_path.exists() {
            continue;
        }

        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let lines: Vec<&str> = content.lines().collect();

        let mut i = 0;
        while i < lines.len() {
            let line = lines[i];
            let line_lower = line.to_lowercase();
            let line_trimmed = line.trim();

            // Classify this line
            if let Some((priority, exact_name)) = classify_sdk_match(line_trimmed, &line_lower, &query_lower) {
                let (block_start, block_end) = extract_code_block(&lines, i);
                let block_content: String = lines[block_start..=block_end].join("\n");

                // Skip duplicates
                let already_exists = scored_matches
                    .iter()
                    .any(|m| m.sdk_match.file == *file_name && m.sdk_match.line_start == block_start + 1);

                if !already_exists && block_content.len() < 3000 {
                    scored_matches.push(ScoredMatch {
                        sdk_match: SdkDocsMatch {
                            file: file_name.to_string(),
                            content: block_content,
                            line_start: block_start + 1,
                            line_end: block_end + 1,
                        },
                        priority,
                        exact_name,
                    });
                }

                i = block_end + 1;
                continue;
            }
            i += 1;
        }
    }

    // Sort: lower priority number = higher importance, exact name matches first
    scored_matches.sort_by(|a, b| match a.priority.cmp(&b.priority) {
        std::cmp::Ordering::Equal => b.exact_name.cmp(&a.exact_name),
        other => other,
    });

    // Take top 5
    let matches: Vec<SdkDocsMatch> = scored_matches
        .into_iter()
        .take(5)
        .map(|sm| sm.sdk_match)
        .collect();

    let found = !matches.is_empty();
    let message = if found {
        format!(
            "Found {} matching section(s) in SDK documentation",
            matches.len()
        )
    } else {
        format!("No matches found for '{}' in SDK documentation", query)
    };

    info!(
        "📚 SDK search complete: {} matches for '{}'",
        matches.len(),
        query
    );

    Ok(SdkDocsResult {
        found,
        matches,
        message,
    })
}

/// Classify a line match by priority and exactness
fn classify_sdk_match(line_trimmed: &str, line_lower: &str, query_lower: &str) -> Option<(MatchPriority, bool)> {
    // Check for exact function/export definition
    if line_trimmed.starts_with("export function ") || line_trimmed.starts_with("export async function ") {
        if line_lower.contains(query_lower) {
            let exact = line_lower.contains(&format!("function {}", query_lower));
            return Some((MatchPriority::ExactDefinition, exact));
        }
    }

    // Check for interface/type definition
    if line_trimmed.starts_with("export interface ") || line_trimmed.starts_with("export type ") {
        if line_lower.contains(query_lower) {
            let exact = line_lower.contains(&format!("interface {}", query_lower))
                || line_lower.contains(&format!("type {} ", query_lower))
                || line_lower.contains(&format!("type {}<", query_lower));
            return Some((MatchPriority::TypeDefinition, exact));
        }
    }

    // Check for const export (helper functions like retry, success, next)
    if line_trimmed.starts_with("export const ") || line_trimmed.starts_with("export {") {
        if line_lower.contains(query_lower) {
            let exact = line_lower.contains(&format!("const {} ", query_lower))
                || line_lower.contains(&format!("const {}=", query_lower));
            return Some((MatchPriority::ExactDefinition, exact));
        }
    }

    // Check for doc comment
    if line_trimmed.starts_with("/**") || line_trimmed.starts_with("*") {
        if line_lower.contains(query_lower) {
            return Some((MatchPriority::DocComment, false));
        }
    }

    // General reference - only for specific enough queries
    if line_lower.contains(query_lower) && query_lower.len() > 5 {
        return Some((MatchPriority::Reference, false));
    }

    None
}

/// Extract the code block containing a line (finds interface/function/class boundaries)
fn extract_code_block(lines: &[&str], target_line: usize) -> (usize, usize) {
    let mut start = target_line;
    let mut end = target_line;
    let mut brace_count = 0;
    let mut found_start = false;

    // Find start: look backwards for interface/function/class/export declaration
    for i in (0..=target_line).rev() {
        let line = lines[i].trim();

        // Found a declaration start (export/interface/type/function/class/const)
        if line.starts_with("export ")
            || line.starts_with("interface ")
            || line.starts_with("type ")
            || line.starts_with("function ")
            || line.starts_with("class ")
            || line.starts_with("const ")
        {
            start = i;
            found_start = true;

            // Check if there's a doc comment above this declaration
            if i > 0 {
                // Look backwards for /** ... */ block
                let mut doc_start = i;
                for j in (0..i).rev() {
                    let prev_line = lines[j].trim();
                    if prev_line.starts_with("/**") {
                        doc_start = j;
                        break;
                    } else if prev_line.starts_with("*") || prev_line.starts_with("*/") {
                        // Part of doc comment, continue looking
                        continue;
                    } else if prev_line.is_empty() {
                        // Empty line - stop if we haven't found doc comment start
                        break;
                    } else {
                        // Some other code - stop
                        break;
                    }
                }
                start = doc_start;
            }
            break;
        }

        // Found a standalone doc comment start
        if line.starts_with("/**") {
            start = i;
            found_start = true;
            break;
        }

        // Stop if we hit an empty line after finding content
        if line.is_empty() && i < target_line && !lines[i + 1].trim().is_empty() {
            start = i + 1;
            found_start = true;
            break;
        }
    }

    if !found_start {
        start = target_line.saturating_sub(2);
    }

    // Find end: count braces to find block end
    for i in start..lines.len() {
        let line = lines[i];
        brace_count += line.matches('{').count() as i32;
        brace_count -= line.matches('}').count() as i32;

        end = i;

        // Found matching close brace
        if brace_count <= 0 && i > target_line {
            break;
        }

        // Stop at next declaration (unless we're inside braces)
        if brace_count == 0
            && i > target_line
            && (line.trim().starts_with("export ")
                || line.trim().starts_with("interface ")
                || line.trim().starts_with("/**"))
        {
            end = i - 1;
            break;
        }

        // Limit extraction size
        if i - start > 50 {
            end = i;
            break;
        }
    }

    (start, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tsc_errors() {
        let output = r#"
src/terminator.ts(10,5): error TS2304: Cannot find name 'foo'.
src/steps/login.ts(25,10): error TS2339: Property 'bar' does not exist on type 'Context'.
"#;

        let errors = parse_tsc_errors(output);
        assert_eq!(errors.len(), 2);

        assert_eq!(errors[0].file, "src/terminator.ts");
        assert_eq!(errors[0].line, 10);
        assert_eq!(errors[0].column, 5);
        assert_eq!(errors[0].code, "TS2304");
        assert_eq!(errors[0].message, "Cannot find name 'foo'.");

        assert_eq!(errors[1].file, "src/steps/login.ts");
        assert_eq!(errors[1].line, 25);
        assert_eq!(errors[1].column, 10);
        assert_eq!(errors[1].code, "TS2339");
        assert_eq!(
            errors[1].message,
            "Property 'bar' does not exist on type 'Context'."
        );
    }

    #[test]
    fn test_parse_empty_output() {
        let errors = parse_tsc_errors("");
        assert_eq!(errors.len(), 0);
    }

    #[test]
    fn test_parse_non_error_output() {
        let output = "Compiling...\nDone in 1.2s";
        let errors = parse_tsc_errors(output);
        assert_eq!(errors.len(), 0);
    }

    #[test]
    fn test_get_error_context_formats_correctly() {
        use std::io::Write;
        use tempfile::TempDir;

        // Create a temp workflow directory with a test file
        let temp_dir = TempDir::new().unwrap();
        let src_dir = temp_dir.path().join("src");
        std::fs::create_dir_all(&src_dir).unwrap();

        let test_file = src_dir.join("terminator.ts");
        let mut file = std::fs::File::create(&test_file).unwrap();
        writeln!(
            file,
            "import {{ createWorkflow }} from '@mediar-ai/workflow';"
        )
        .unwrap();
        writeln!(file, "").unwrap();
        writeln!(file, "export default createWorkflow({{").unwrap();
        writeln!(file, "  name: 'test',  // This causes TS2769").unwrap();
        writeln!(file, "  input: schema,").unwrap();
        writeln!(file, "  steps: [],").unwrap();
        writeln!(file, "}});").unwrap();

        let error = TypecheckError {
            file: "src/terminator.ts".to_string(),
            line: 4,
            column: 3,
            code: "TS2769".to_string(),
            message: "No overload matches this call.".to_string(),
            context: None,
        };

        let context = get_error_context(temp_dir.path(), &error).unwrap();

        // Should include the error line with arrow marker
        assert!(context.contains(" → "), "should have arrow marker");
        assert!(
            context.contains("name: 'test'"),
            "should include error line"
        );
        // Should include surrounding context
        assert!(
            context.contains("createWorkflow"),
            "should include lines before error"
        );
        assert!(
            context.contains("input:"),
            "should include lines after error"
        );
    }

    // =========================================================================
    // SDK Search Quality Benchmarks
    // =========================================================================
    // These tests validate we return "smallest set of high-signal tokens"
    // (Anthropic context engineering principle)

    #[test]
    fn test_classify_sdk_match_prioritizes_function_definition() {
        // Function definition should be ExactDefinition priority
        let (priority, exact) = classify_sdk_match(
            "export function createWorkflow<TInput = any>(",
            "export function createworkflow<tinput = any>(",
            "createworkflow",
        )
        .unwrap();
        assert_eq!(priority, MatchPriority::ExactDefinition);
        assert!(exact, "should be exact name match");
    }

    #[test]
    fn test_classify_sdk_match_prioritizes_interface_over_reference() {
        // Interface definition should be TypeDefinition priority
        let (priority, exact) = classify_sdk_match(
            "export interface WorkflowConfig<TInput = any> {",
            "export interface workflowconfig<tinput = any> {",
            "workflowconfig",
        )
        .unwrap();
        assert_eq!(priority, MatchPriority::TypeDefinition);
        assert!(exact);

        // Random reference should be lower priority
        let result = classify_sdk_match(
            "    const config: WorkflowConfig = {};",
            "    const config: workflowconfig = {};",
            "workflowconfig",
        );
        // Should match as Reference (query > 5 chars)
        assert!(result.is_some());
        let (priority, _) = result.unwrap();
        assert_eq!(priority, MatchPriority::Reference);
    }

    #[test]
    fn test_classify_sdk_match_doc_comment() {
        // Doc comments start with "/**" or "*" (trimmed)
        // Query must actually appear in the line
        let (priority, _) = classify_sdk_match(
            "* Use createStep to define workflow steps",
            "* use createstep to define workflow steps",
            "createstep",
        )
        .unwrap();
        assert_eq!(priority, MatchPriority::DocComment);

        // Also test /** start
        let (priority2, _) = classify_sdk_match(
            "/** createStep - Creates a workflow step",
            "/** createstep - creates a workflow step",
            "createstep",
        )
        .unwrap();
        assert_eq!(priority2, MatchPriority::DocComment);
    }

    #[test]
    fn test_classify_sdk_match_const_export() {
        // Helper functions like retry, success, next
        let (priority, exact) = classify_sdk_match(
            "export function retry(): RetryMarker {",
            "export function retry(): retrymarker {",
            "retry",
        )
        .unwrap();
        assert_eq!(priority, MatchPriority::ExactDefinition);
        assert!(exact);
    }

    #[test]
    fn test_classify_sdk_match_rejects_short_generic_queries() {
        // Short queries (<=5 chars) that aren't definitions should not match
        let result = classify_sdk_match(
            "    return { state: value };",
            "    return { state: value };",
            "state", // 5 chars - should not match as Reference
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_code_block_finds_function_boundaries() {
        // Note: lines are 0-indexed in the vec
        // Line 0: ""
        // Line 1: "/**"
        // Line 2: " * Creates a workflow step"
        // Line 3: " */"
        // Line 4: "export function createStep<TInput>("
        // ...
        let code = r#"/**
 * Creates a workflow step
 */
export function createStep<TInput>(
    config: StepConfig<TInput>,
): Step<TInput> {
    return {
        config,
        run: async () => {},
    };
}

export function otherFunction() {"#;
        let lines: Vec<&str> = code.lines().collect();

        // Target line 3 (export function createStep - 0-indexed)
        let (start, end) = extract_code_block(&lines, 3);

        let block: String = lines[start..=end].join("\n");
        assert!(
            block.contains("Creates a workflow step"),
            "should include doc comment, got: {}",
            block
        );
        assert!(
            block.contains("export function createStep"),
            "should include function"
        );
        assert!(
            !block.contains("otherFunction"),
            "should NOT include next function"
        );
    }

    #[test]
    fn test_extract_code_block_finds_interface_boundaries() {
        // Test case: target the interface declaration line directly
        // Line 0: "export interface StepConfig<TInput = any> {"
        // Line 1: "    id: string;"
        // ...
        let code = r#"export interface StepConfig<TInput = any> {
    id: string;
    name: string;
    execute: (context: StepContext<TInput>) => Promise<void>;
}

export interface OtherInterface {"#;
        let lines: Vec<&str> = code.lines().collect();

        // Target line 0 (the interface declaration itself)
        let (start, end) = extract_code_block(&lines, 0);

        let block: String = lines[start..=end].join("\n");
        assert!(
            block.contains("export interface StepConfig"),
            "should include interface start, got: {}",
            block
        );
        assert!(block.contains("id: string"), "should include body");
        assert!(
            block.contains("execute:"),
            "should include full interface body"
        );
        assert!(
            !block.contains("OtherInterface"),
            "should NOT include next interface"
        );
    }

    #[test]
    fn test_extract_code_block_with_preceding_doc_comment() {
        // When we target a line inside an interface/function,
        // and there's a doc comment above the declaration,
        // we should include the doc comment
        let code = r#"/**
 * Step configuration options
 */
export interface StepConfig {
    id: string;
}

export interface Other {"#;
        let lines: Vec<&str> = code.lines().collect();

        // Target line 4 (id: string)
        let (start, end) = extract_code_block(&lines, 4);

        let block: String = lines[start..=end].join("\n");
        assert!(
            block.contains("Step configuration options"),
            "should include doc comment, got: {}",
            block
        );
        assert!(
            block.contains("export interface StepConfig"),
            "should include interface"
        );
    }

    #[test]
    fn test_high_signal_token_quality() {
        // Benchmark: For "createWorkflow" query, the FIRST result should be
        // the actual function definition, not a random reference or interface usage

        // Simulate what search would find
        let matches = vec![
            (
                "types.ts",
                "export interface WorkflowContext<TInput = any> {",
                10,
            ),
            (
                "workflow.ts",
                "export function createWorkflow<TInput = any>(",
                599,
            ),
            ("types.ts", " * @see createWorkflow for usage", 50),
        ];

        let mut scored: Vec<(MatchPriority, bool, &str)> = matches
            .iter()
            .map(|(file, line, _)| {
                let line_lower = line.to_lowercase();
                let (priority, exact) = classify_sdk_match(line.trim(), &line_lower, "createworkflow")
                    .unwrap_or((MatchPriority::Reference, false));
                (priority, exact, *file)
            })
            .collect();

        // Sort by priority (lower = better), then exact match
        scored.sort_by(|a, b| match a.0.cmp(&b.0) {
            std::cmp::Ordering::Equal => b.1.cmp(&a.1),
            other => other,
        });

        // The FIRST result should be workflow.ts with the actual function def
        assert_eq!(
            scored[0].2, "workflow.ts",
            "First result should be the actual function definition, not a reference"
        );
        assert_eq!(
            scored[0].0,
            MatchPriority::ExactDefinition,
            "Should be classified as ExactDefinition"
        );
    }
}
