//! Type Definition Reading for In-Editor Type Checking
//!
//! Provides Tauri commands to read .d.ts files from workflow's node_modules
//! for powering in-editor TypeScript type checking.

use log::info;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

use super::workflows::get_workflows_directory_sync;

/// Result of reading type definitions
#[derive(Debug, Serialize, specta::Type)]
pub struct TypeDefinitionsResult {
    /// Map of virtual path to .d.ts content
    pub definitions: HashMap<String, String>,
    /// Packages that were successfully loaded
    pub loaded: Vec<String>,
    /// Packages that failed to load (with error messages)
    pub failed: Vec<TypeDefinitionError>,
}

/// Error when loading a type definition
#[derive(Debug, Serialize, specta::Type)]
pub struct TypeDefinitionError {
    /// Package name that failed
    pub package: String,
    /// Error message
    pub error: String,
}

/// Find workflow folder path by UUID
fn find_workflow_path_by_uuid(workflows_dir: &std::path::Path, uuid: &str) -> Option<PathBuf> {
    use std::fs;

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

    let direct_path = workflows_dir.join(uuid);
    if direct_path.exists() && direct_path.is_dir() {
        return Some(direct_path);
    }

    None
}

/// Get the app's node_modules path (for bundled SDK types)
fn get_app_node_modules() -> Option<PathBuf> {
    // In development, node_modules is in the project root
    // In production, we'll need to bundle types or use a different approach
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("node_modules"));

    if let Some(path) = dev_path {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

/// Read TypeScript type definitions from workflow's node_modules
///
/// Reads .d.ts files for specified packages to enable in-editor type checking.
/// Returns a map of virtual file paths to their contents.
///
/// Falls back to app's node_modules for SDK packages when workflow doesn't have
/// dependencies installed.
#[tauri::command]
#[specta::specta]
pub async fn read_type_definitions(
    workflow_id: String,
    packages: Vec<String>,
) -> Result<TypeDefinitionsResult, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    let workflow_node_modules = workflow_path.join("node_modules");
    let app_node_modules = get_app_node_modules();

    // If neither exists, return error
    if !workflow_node_modules.exists() && app_node_modules.is_none() {
        return Err("No node_modules found. Run 'bun install' in the workflow directory.".to_string());
    }

    let mut definitions: HashMap<String, String> = HashMap::new();
    let mut loaded: Vec<String> = Vec::new();
    let mut failed: Vec<TypeDefinitionError> = Vec::new();

    for package in packages {
        // Try workflow's node_modules first
        let result = if workflow_node_modules.exists() {
            read_package_types(&workflow_node_modules, &package)
        } else {
            Err("workflow node_modules not found".to_string())
        };

        // Fall back to app's node_modules (for SDK packages)
        let result = match result {
            Ok(types) => Ok(types),
            Err(_) => {
                if let Some(ref app_nm) = app_node_modules {
                    read_package_types(app_nm, &package)
                } else {
                    Err(format!("Package not found: {}", package))
                }
            }
        };

        match result {
            Ok(types) => {
                for (path, content) in types {
                    definitions.insert(path, content);
                }
                loaded.push(package);
            }
            Err(e) => {
                failed.push(TypeDefinitionError { package, error: e });
            }
        }
    }

    info!(
        "📦 Loaded type definitions: {} packages ({} failed)",
        loaded.len(),
        failed.len()
    );

    Ok(TypeDefinitionsResult {
        definitions,
        loaded,
        failed,
    })
}

/// Read type definitions for a single package
fn read_package_types(node_modules: &std::path::Path, package: &str) -> Result<Vec<(String, String)>, String> {
    use std::fs;

    let package_path = node_modules.join(package);
    if !package_path.exists() {
        return Err(format!("Package not found: {}", package));
    }

    let mut results: Vec<(String, String)> = Vec::new();

    // Try to find type definitions in order of preference:
    // 1. Package's own .d.ts files (from "types" or "typings" field in package.json)
    // 2. index.d.ts in package root
    // 3. dist/index.d.ts
    // 4. @types/{package} as fallback

    let package_json_path = package_path.join("package.json");
    let types_entry = if package_json_path.exists() {
        let content =
            fs::read_to_string(&package_json_path).map_err(|e| format!("Failed to read package.json: {}", e))?;

        // Include package.json for module resolution
        let virtual_path = format!("/node_modules/{}/package.json", package);
        results.push((virtual_path, content.clone()));

        let pkg: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse package.json: {}", e))?;

        pkg.get("types")
            .or_else(|| pkg.get("typings"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    // Find the types directory (dist, lib, types, or root)
    let types_dir = if let Some(entry) = &types_entry {
        // Get the directory containing the types entry
        let entry_path = package_path.join(entry);
        entry_path.parent().map(|p| p.to_path_buf())
    } else {
        // Try common directories
        let candidates = vec![
            package_path.join("dist"),
            package_path.join("lib"),
            package_path.join("types"),
        ];
        candidates.into_iter().find(|p| p.exists())
    };

    // Load ALL .d.ts files from the types directory
    if let Some(dir) = types_dir {
        if dir.exists() {
            load_all_dts_files(&dir, node_modules, &mut results)?;
        }
    }

    // Also try root-level .d.ts files
    if package_path.join("index.d.ts").exists() {
        let content = fs::read_to_string(package_path.join("index.d.ts"))
            .map_err(|e| format!("Failed to read index.d.ts: {}", e))?;
        let virtual_path = format!("/node_modules/{}/index.d.ts", package);
        if !results.iter().any(|(p, _)| p == &virtual_path) {
            results.push((virtual_path, content));
        }
    }

    if results.len() <= 1 {
        // Only have package.json, try @types package
        let types_package = node_modules.join("@types").join(package.replace('/', "__"));
        if types_package.exists() {
            load_all_dts_files(&types_package, node_modules, &mut results)?;
        }
    }

    // Check if we actually loaded any .d.ts files (not just package.json)
    let has_dts = results.iter().any(|(p, _)| p.ends_with(".d.ts"));
    if !has_dts {
        return Err(format!("No type definitions found for: {}", package));
    }

    Ok(results)
}

/// Recursively load all .d.ts files from a directory
fn load_all_dts_files(
    dir: &std::path::Path,
    node_modules: &std::path::Path,
    results: &mut Vec<(String, String)>,
) -> Result<(), String> {
    use std::fs;

    if !dir.exists() {
        return Ok(());
    }

    // Skip node_modules and other non-essential directories
    if let Some(name) = dir.file_name() {
        let name_str = name.to_string_lossy();
        if name_str == "node_modules"
            || name_str == "src"
            || name_str == "tests"
            || name_str == "test"
            || name_str == "scripts"
            || name_str.starts_with('.')
        {
            return Ok(());
        }
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            // Recurse into subdirectories
            load_all_dts_files(&path, node_modules, results)?;
        } else if path.extension().map(|e| e == "ts").unwrap_or(false) {
            // Check if it's a .d.ts file
            if let Some(stem) = path.file_stem() {
                if stem.to_string_lossy().ends_with(".d") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(relative) = path.strip_prefix(node_modules) {
                            let virtual_path = format!(
                                "/node_modules/{}",
                                relative.display().to_string().replace('\\', "/")
                            );
                            if !results.iter().any(|(p, _)| p == &virtual_path) {
                                results.push((virtual_path, content));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

/// Read all TypeScript source files from a workflow
/// Returns a map of virtual paths to file contents for the virtual FS
#[tauri::command]
#[specta::specta]
pub async fn read_workflow_source_files(workflow_id: String) -> Result<HashMap<String, String>, String> {
    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    let mut files: HashMap<String, String> = HashMap::new();

    // Read all .ts and .tsx files from the workflow directory
    read_ts_files_recursive(&workflow_path, &workflow_path, &mut files)?;

    info!("📄 Loaded {} source files from workflow", files.len());

    Ok(files)
}

/// Recursively read all TypeScript files from a directory
fn read_ts_files_recursive(
    base_path: &std::path::Path,
    current_path: &std::path::Path,
    files: &mut HashMap<String, String>,
) -> Result<(), String> {
    use std::fs;

    if !current_path.exists() || !current_path.is_dir() {
        return Ok(());
    }

    // Skip node_modules and hidden directories
    if let Some(name) = current_path.file_name() {
        let name_str = name.to_string_lossy();
        if name_str == "node_modules" || name_str.starts_with('.') {
            return Ok(());
        }
    }

    let entries =
        fs::read_dir(current_path).map_err(|e| format!("Failed to read dir {}: {}", current_path.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            read_ts_files_recursive(base_path, &path, files)?;
        } else if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ext_str == "ts" || ext_str == "tsx" {
                if let Ok(content) = fs::read_to_string(&path) {
                    // Create virtual path relative to workflow root
                    if let Ok(relative) = path.strip_prefix(base_path) {
                        let virtual_path = format!("/{}", relative.display().to_string().replace('\\', "/"));
                        files.insert(virtual_path, content);
                    }
                }
            }
        }
    }

    Ok(())
}

/// Get the list of packages that should have type definitions loaded
#[tauri::command]
#[specta::specta]
pub async fn get_workflow_type_packages(workflow_id: String) -> Result<Vec<String>, String> {
    use std::fs;

    let workflows_dir = get_workflows_directory_sync()?;
    let workflows_path = PathBuf::from(&workflows_dir);

    let workflow_path = find_workflow_path_by_uuid(&workflows_path, &workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    let package_json_path = workflow_path.join("package.json");
    if !package_json_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&package_json_path).map_err(|e| format!("Failed to read package.json: {}", e))?;
    let pkg: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse package.json: {}", e))?;

    let mut packages: Vec<String> = Vec::new();

    if let Some(deps) = pkg.get("dependencies").and_then(|v| v.as_object()) {
        for key in deps.keys() {
            packages.push(key.clone());
        }
    }

    if let Some(deps) = pkg.get("devDependencies").and_then(|v| v.as_object()) {
        for key in deps.keys() {
            if key.starts_with("@types/") {
                packages.push(key.clone());
            }
        }
    }

    // Add terminator as transitive dep - workflow types use import("@mediar-ai/terminator").Desktop
    if packages.contains(&"@mediar-ai/workflow".to_string())
        && !packages.contains(&"@mediar-ai/terminator".to_string())
    {
        packages.push("@mediar-ai/terminator".to_string());
    }

    Ok(packages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_mock_package(node_modules: &std::path::Path, name: &str, types_content: &str, types_field: Option<&str>) {
        let pkg_path = node_modules.join(name);
        fs::create_dir_all(&pkg_path).unwrap();

        // Create package.json
        let pkg_json = if let Some(types) = types_field {
            format!(r#"{{"name": "{}", "types": "{}"}}"#, name, types)
        } else {
            format!(r#"{{"name": "{}"}}"#, name)
        };
        fs::write(pkg_path.join("package.json"), pkg_json).unwrap();

        // Create types file
        if let Some(types) = types_field {
            let types_path = pkg_path.join(types);
            if let Some(parent) = types_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(types_path, types_content).unwrap();
        } else {
            fs::write(pkg_path.join("index.d.ts"), types_content).unwrap();
        }
    }

    #[test]
    fn test_read_package_types_from_types_field() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        fs::create_dir_all(&node_modules).unwrap();

        create_mock_package(
            &node_modules,
            "test-pkg",
            "export declare function hello(): string;",
            Some("dist/index.d.ts"),
        );

        let result = read_package_types(&node_modules, "test-pkg").unwrap();
        // Now includes package.json + .d.ts file
        assert!(result.len() >= 1);
        assert!(result.iter().any(|(p, _)| p.contains("test-pkg")));
        assert!(result.iter().any(|(_, c)| c.contains("hello")));
    }

    #[test]
    fn test_read_package_types_fallback_index() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        fs::create_dir_all(&node_modules).unwrap();

        create_mock_package(
            &node_modules,
            "simple-pkg",
            "export declare const VERSION: string;",
            None,
        );

        let result = read_package_types(&node_modules, "simple-pkg").unwrap();
        // Now includes package.json + .d.ts file
        assert!(result.len() >= 1);
        assert!(result.iter().any(|(_, c)| c.contains("VERSION")));
    }

    #[test]
    fn test_read_package_types_not_found() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        fs::create_dir_all(&node_modules).unwrap();

        let result = read_package_types(&node_modules, "nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_read_package_types_from_at_types() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        let types_path = node_modules.join("@types").join("somepkg");
        fs::create_dir_all(&types_path).unwrap();

        // Create package without types
        let pkg_path = node_modules.join("somepkg");
        fs::create_dir_all(&pkg_path).unwrap();
        fs::write(pkg_path.join("package.json"), r#"{"name": "somepkg"}"#).unwrap();
        // No index.d.ts

        // Create @types/somepkg
        fs::write(
            types_path.join("index.d.ts"),
            "export declare function typed(): void;",
        )
        .unwrap();

        let result = read_package_types(&node_modules, "somepkg").unwrap();
        // Should find types from @types package
        assert!(result.iter().any(|(p, _)| p.contains("@types")));
        assert!(result.iter().any(|(_, c)| c.contains("typed")));
    }

    #[test]
    fn test_includes_package_json() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        fs::create_dir_all(&node_modules).unwrap();

        create_mock_package(
            &node_modules,
            "pkg-with-json",
            "export declare const FOO: string;",
            None,
        );

        let result = read_package_types(&node_modules, "pkg-with-json").unwrap();
        // Should include package.json for module resolution
        assert!(result.iter().any(|(p, _)| p.ends_with("package.json")));
        assert!(result.iter().any(|(p, _)| p.ends_with(".d.ts")));
    }

    #[test]
    fn test_loads_multiple_dts_files() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        let pkg_path = node_modules.join("multi-file-pkg");
        let dist_path = pkg_path.join("dist");
        fs::create_dir_all(&dist_path).unwrap();

        // Create package.json
        fs::write(
            pkg_path.join("package.json"),
            r#"{"name": "multi-file-pkg", "types": "dist/index.d.ts"}"#,
        )
        .unwrap();

        // Create multiple .d.ts files
        fs::write(dist_path.join("index.d.ts"), "export * from './utils';").unwrap();
        fs::write(
            dist_path.join("utils.d.ts"),
            "export declare function util(): void;",
        )
        .unwrap();

        let result = read_package_types(&node_modules, "multi-file-pkg").unwrap();
        // Should load all .d.ts files
        let dts_count = result.iter().filter(|(p, _)| p.ends_with(".d.ts")).count();
        assert!(
            dts_count >= 2,
            "Should load multiple .d.ts files, got {}",
            dts_count
        );
    }

    #[test]
    fn test_virtual_path_format() {
        let temp = TempDir::new().unwrap();
        let node_modules = temp.path().join("node_modules");
        fs::create_dir_all(&node_modules).unwrap();

        create_mock_package(
            &node_modules,
            "my-lib",
            "export declare type Config = {};",
            None,
        );

        let result = read_package_types(&node_modules, "my-lib").unwrap();
        // All paths should start with /node_modules/
        for (path, _) in &result {
            assert!(
                path.starts_with("/node_modules/"),
                "Path should start with /node_modules/: {}",
                path
            );
        }
    }
}
