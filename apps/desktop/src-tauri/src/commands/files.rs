//! File operation commands for the file explorer context menu.
//!
//! Provides Tauri commands for:
//! - Revealing files/folders in the system file explorer
//! - Renaming files and folders
//! - Deleting files and folders (to trash or permanently)
//! - Duplicating files
//! - Creating new files and folders

use log::info;
use std::fs;
use std::path::PathBuf;

/// Reveal a file or folder in the system's file explorer
#[tauri::command]
#[specta::specta]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    info!("Revealing in explorer: {}", path);
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // If it's a file, select it in explorer; if directory, open it
        let (arg, target) = if path.is_file() {
            ("/select,", path.to_string_lossy().to_string())
        } else {
            ("", path.to_string_lossy().to_string())
        };

        std::process::Command::new("explorer.exe")
            .arg(format!("{}{}", arg, target))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try to use xdg-open on the parent directory
        let parent = path.parent().unwrap_or(&path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}

/// Rename a file or folder
#[tauri::command]
#[specta::specta]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    info!("Renaming: {} -> {}", old_path, new_path);
    let old_path = PathBuf::from(&old_path);
    let new_path = PathBuf::from(&new_path);

    if !old_path.exists() {
        return Err(format!(
            "Source path does not exist: {}",
            old_path.display()
        ));
    }

    if new_path.exists() {
        return Err(format!(
            "Destination already exists: {}",
            new_path.display()
        ));
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;

    info!("Renamed successfully");
    Ok(())
}

/// Delete a file or folder
#[tauri::command]
#[specta::specta]
pub fn delete_file(path: String, to_trash: bool) -> Result<(), String> {
    info!("Deleting: {} (to_trash: {})", path, to_trash);
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    if to_trash {
        // Move to trash using trash crate
        trash::delete(&path).map_err(|e| format!("Failed to move to trash: {}", e))?;
    } else {
        // Permanent delete
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))?;
        } else {
            fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
    }

    info!("Deleted successfully");
    Ok(())
}

/// Duplicate a file
#[tauri::command]
#[specta::specta]
pub fn duplicate_file(path: String) -> Result<String, String> {
    info!("Duplicating: {}", path);
    let source = PathBuf::from(&path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source.display()));
    }

    if source.is_dir() {
        return Err("Cannot duplicate directories".to_string());
    }

    // Generate a unique name for the copy
    let parent = source.parent().ok_or("Failed to get parent directory")?;
    let stem = source
        .file_stem()
        .ok_or("Failed to get file stem")?
        .to_string_lossy();
    let extension = source.extension().map(|e| e.to_string_lossy().to_string());

    let mut counter = 1;
    let new_path = loop {
        let new_name = if let Some(ref ext) = extension {
            format!(
                "{} copy{}.{}",
                stem,
                if counter > 1 {
                    format!(" {}", counter)
                } else {
                    String::new()
                },
                ext
            )
        } else {
            format!(
                "{} copy{}",
                stem,
                if counter > 1 {
                    format!(" {}", counter)
                } else {
                    String::new()
                }
            )
        };
        let candidate = parent.join(&new_name);
        if !candidate.exists() {
            break candidate;
        }
        counter += 1;
        if counter > 100 {
            return Err("Too many copies exist".to_string());
        }
    };

    fs::copy(&source, &new_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    let result = new_path.to_string_lossy().to_string();
    info!("Duplicated to: {}", result);
    Ok(result)
}

/// Create a new file with optional content
#[tauri::command]
#[specta::specta]
pub fn create_file(path: String, content: Option<String>) -> Result<(), String> {
    info!("Creating file: {}", path);
    let path = PathBuf::from(&path);

    if path.exists() {
        return Err(format!("File already exists: {}", path.display()));
    }

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
    }

    fs::write(&path, content.unwrap_or_default()).map_err(|e| format!("Failed to create file: {}", e))?;

    info!("File created successfully");
    Ok(())
}

/// Create a new folder
#[tauri::command]
#[specta::specta]
pub fn create_folder(path: String) -> Result<(), String> {
    info!("Creating folder: {}", path);
    let path = PathBuf::from(&path);

    if path.exists() {
        return Err(format!("Folder already exists: {}", path.display()));
    }

    fs::create_dir_all(&path).map_err(|e| format!("Failed to create folder: {}", e))?;

    info!("Folder created successfully");
    Ok(())
}
