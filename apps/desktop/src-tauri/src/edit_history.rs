//! Edit History Module
//!
//! Provides undo/redo functionality for workflow file edits.
//! Stores file snapshots in .mediar/history/ folder with content-addressed storage.

use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
// NOTE: sha2 crate removed - was causing SIGILL crashes on some CPUs due to SIMD instructions
// Now using pure Rust FNV-1a hash instead
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Create a directory and optionally hide it on Windows
/// On Windows, sets FILE_ATTRIBUTE_HIDDEN on the directory
fn create_hidden_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

        // Check if already hidden
        if let Ok(metadata) = fs::metadata(path) {
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
                warn!(
                    "⚠️ Failed to set hidden attribute on {}: {}",
                    path.display(),
                    std::io::Error::last_os_error()
                );
            }
        }
    }

    Ok(())
}

/// Maximum number of edit entries to keep per workflow
const MAX_HISTORY_ENTRIES: usize = 50;

/// A single file change within an edit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    /// Relative path from workflow root (e.g., "src/terminator.ts")
    pub path: String,
    /// SHA256 hash of content before the change (references snapshot)
    pub before_hash: String,
    /// SHA256 hash of content after the change (references snapshot)
    pub after_hash: String,
}

/// A single edit entry (may contain multiple file changes)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditEntry {
    /// Unique ID for this edit
    pub id: String,
    /// Timestamp when the edit was recorded
    pub timestamp: i64,
    /// List of file changes in this edit
    pub changes: Vec<FileChange>,
}

/// Index file structure persisted to disk
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryIndex {
    /// Version for future compatibility
    pub version: u32,
    /// List of edit entries (oldest first)
    pub entries: Vec<EditEntry>,
    /// Current position in history (for undo/redo)
    /// Points to the last applied edit. -1 means no edits applied (initial state)
    pub current_index: i32,
}

/// Result of an undo/redo operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreResult {
    pub success: bool,
    pub error: Option<String>,
    /// Files that were restored with their new content and diff info
    pub restored_files: Vec<RestoredFile>,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// A file that was restored during undo/redo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoredFile {
    pub path: String,
    pub content: String,
    /// The content before the restore operation - for merge view diff display
    pub original_content: String,
}

/// Edit history state for a single workflow
#[derive(Debug)]
pub struct EditHistory {
    #[allow(dead_code)] // Kept for debugging and future use
    workflow_id: String,
    workflow_path: PathBuf,
    history_dir: PathBuf,
    snapshots_dir: PathBuf,
    index: HistoryIndex,
    /// In-memory cache of snapshots (hash -> content)
    snapshot_cache: HashMap<String, String>,
}

impl EditHistory {
    /// Create or load edit history for a workflow
    pub fn new(workflow_id: &str, workflow_path: &Path) -> Result<Self, String> {
        let mediar_dir = workflow_path.join(".mediar");
        let history_dir = mediar_dir.join("history");
        let snapshots_dir = history_dir.join("snapshots");

        // Create .mediar directory and hide it on Windows
        create_hidden_directory(&mediar_dir).map_err(|e| format!("Failed to create .mediar directory: {}", e))?;

        // Create subdirectories
        fs::create_dir_all(&snapshots_dir).map_err(|e| format!("Failed to create history directory: {}", e))?;

        // Load existing index or create new one
        let index_path = history_dir.join("index.json");
        let index = if index_path.exists() {
            let content =
                fs::read_to_string(&index_path).map_err(|e| format!("Failed to read history index: {}", e))?;
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse history index: {}", e))?
        } else {
            HistoryIndex {
                version: 1,
                entries: Vec::new(),
                current_index: -1,
            }
        };

        info!(
            "📜 [EDIT_HISTORY] Loaded history for {}: {} entries, current_index={}",
            workflow_id,
            index.entries.len(),
            index.current_index
        );

        Ok(Self {
            workflow_id: workflow_id.to_string(),
            workflow_path: workflow_path.to_path_buf(),
            history_dir,
            snapshots_dir,
            index,
            snapshot_cache: HashMap::new(),
        })
    }

    /// Compute a simple hash of content using FNV-1a algorithm
    /// This is a pure Rust implementation with no CPU-specific instructions,
    /// making it safe from SIGILL crashes that can occur with SHA256 on some CPUs.
    fn hash_content(content: &str) -> String {
        // TEMP_LOG: Confirm hash_content is called
        info!("🔐 [HASH] Computing FNV hash for {} bytes", content.len());

        // FNV-1a hash - pure Rust, no SIMD, safe on all CPUs
        const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x100000001b3;

        let mut hash = FNV_OFFSET_BASIS;
        for byte in content.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(FNV_PRIME);
        }

        // Include content length for extra uniqueness
        let len = content.len();
        hash ^= len as u64;
        hash = hash.wrapping_mul(FNV_PRIME);

        // TEMP_LOG: Hash computed
        info!("🔐 [HASH] FNV hash computed: {:016x}", hash);

        format!("{:016x}_{:08x}", hash, len)
    }

    /// Save a snapshot to disk and cache
    fn save_snapshot(&mut self, content: &str) -> Result<String, String> {
        // TEMP_LOG: Before hash
        info!(
            "💾 [SAVE_SNAPSHOT] Computing hash for {} bytes...",
            content.len()
        );

        let hash = Self::hash_content(content);

        // TEMP_LOG: After hash
        info!(
            "💾 [SAVE_SNAPSHOT] Hash computed: {}",
            &hash[..16.min(hash.len())]
        );

        // Check if already exists
        let snapshot_path = self.snapshots_dir.join(format!("{}.txt", &hash[..16]));
        if !snapshot_path.exists() {
            fs::write(&snapshot_path, content).map_err(|e| format!("Failed to write snapshot: {}", e))?;
            debug!("💾 [EDIT_HISTORY] Saved snapshot: {}", &hash[..16]);
        }

        // Cache it
        self.snapshot_cache
            .insert(hash.clone(), content.to_string());

        Ok(hash)
    }

    /// Load a snapshot from disk or cache
    fn load_snapshot(&mut self, hash: &str) -> Result<String, String> {
        // Check cache first
        if let Some(content) = self.snapshot_cache.get(hash) {
            return Ok(content.clone());
        }

        // Load from disk
        let snapshot_path = self.snapshots_dir.join(format!("{}.txt", &hash[..16]));
        let content = fs::read_to_string(&snapshot_path)
            .map_err(|e| format!("Failed to read snapshot {}: {}", &hash[..16], e))?;

        // Cache it
        self.snapshot_cache
            .insert(hash.to_string(), content.clone());

        Ok(content)
    }

    /// Save the index to disk
    fn save_index(&self) -> Result<(), String> {
        let index_path = self.history_dir.join("index.json");
        let content =
            serde_json::to_string_pretty(&self.index).map_err(|e| format!("Failed to serialize index: {}", e))?;
        fs::write(&index_path, content).map_err(|e| format!("Failed to write index: {}", e))?;
        Ok(())
    }

    /// Record a new edit (batch of file changes)
    pub fn record_edit(&mut self, changes: Vec<(String, String, String)>) -> Result<(), String> {
        // TEMP_LOG: Entry point
        info!(
            "📝 [EDIT_HISTORY] record_edit START with {} changes",
            changes.len()
        );

        if changes.is_empty() {
            return Ok(());
        }

        // If we're not at the end of history, truncate future entries
        if self.index.current_index < (self.index.entries.len() as i32 - 1) {
            let truncate_at = (self.index.current_index + 1) as usize;
            info!(
                "✂️ [EDIT_HISTORY] Truncating {} future entries",
                self.index.entries.len() - truncate_at
            );
            self.index.entries.truncate(truncate_at);
        }

        // TEMP_LOG: Before snapshot loop
        info!("📝 [EDIT_HISTORY] Starting snapshot creation loop");

        // Create file changes with snapshots
        let mut file_changes = Vec::new();
        for (idx, (path, before_content, after_content)) in changes.into_iter().enumerate() {
            // TEMP_LOG: Each iteration
            info!(
                "📝 [EDIT_HISTORY] Processing change {} for path: {}",
                idx, path
            );
            info!(
                "📝 [EDIT_HISTORY] Before content: {} bytes",
                before_content.len()
            );

            let before_hash = self.save_snapshot(&before_content)?;
            info!(
                "📝 [EDIT_HISTORY] Before hash computed: {}",
                &before_hash[..16.min(before_hash.len())]
            );

            info!(
                "📝 [EDIT_HISTORY] After content: {} bytes",
                after_content.len()
            );
            let after_hash = self.save_snapshot(&after_content)?;
            info!(
                "📝 [EDIT_HISTORY] After hash computed: {}",
                &after_hash[..16.min(after_hash.len())]
            );

            file_changes.push(FileChange {
                path,
                before_hash,
                after_hash,
            });
        }

        // Create new entry
        let entry = EditEntry {
            id: format!("edit_{}", chrono::Utc::now().timestamp_millis()),
            timestamp: chrono::Utc::now().timestamp(),
            changes: file_changes,
        };

        info!(
            "📝 [EDIT_HISTORY] Recording edit {} with {} file changes",
            entry.id,
            entry.changes.len()
        );

        self.index.entries.push(entry);
        self.index.current_index = self.index.entries.len() as i32 - 1;

        // Trim old entries if over limit
        while self.index.entries.len() > MAX_HISTORY_ENTRIES {
            let removed = self.index.entries.remove(0);
            self.index.current_index -= 1;
            debug!("🗑️ [EDIT_HISTORY] Removed old entry: {}", removed.id);
            // Note: We don't delete snapshot files as they might be referenced by other entries
        }

        // Save index
        self.save_index()?;

        Ok(())
    }

    /// Check if undo is available
    pub fn can_undo(&self) -> bool {
        self.index.current_index >= 0
    }

    /// Check if redo is available
    pub fn can_redo(&self) -> bool {
        self.index.current_index < (self.index.entries.len() as i32 - 1)
    }

    /// Get current history state
    pub fn get_state(&self) -> (bool, bool, usize, i32) {
        (
            self.can_undo(),
            self.can_redo(),
            self.index.entries.len(),
            self.index.current_index,
        )
    }

    /// Perform undo operation
    pub fn undo(&mut self) -> Result<RestoreResult, String> {
        if !self.can_undo() {
            return Ok(RestoreResult {
                success: false,
                error: Some("Nothing to undo".to_string()),
                restored_files: Vec::new(),
                can_undo: false,
                can_redo: self.can_redo(),
            });
        }

        // Clone the entry to avoid borrow checker issues
        let entry = self.index.entries[self.index.current_index as usize].clone();
        info!("⏪ [EDIT_HISTORY] Undoing edit: {}", entry.id);

        let mut restored_files = Vec::new();

        // Restore each file to its "before" state
        for change in &entry.changes {
            let before_content = self.load_snapshot(&change.before_hash)?;
            let after_content = self.load_snapshot(&change.after_hash)?;

            // Write the "before" content back to the file
            let file_path = self.workflow_path.join(&change.path);
            fs::write(&file_path, &before_content)
                .map_err(|e| format!("Failed to restore file {}: {}", change.path, e))?;

            // For undo: original_content is what was there before undo (after_content)
            restored_files.push(RestoredFile {
                path: change.path.clone(),
                content: before_content.clone(),
                original_content: after_content,
            });

            info!("  ↩️ Restored: {}", change.path);
        }

        // Move pointer back
        self.index.current_index -= 1;
        self.save_index()?;

        Ok(RestoreResult {
            success: true,
            error: None,
            restored_files,
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
        })
    }

    /// Perform redo operation
    pub fn redo(&mut self) -> Result<RestoreResult, String> {
        if !self.can_redo() {
            return Ok(RestoreResult {
                success: false,
                error: Some("Nothing to redo".to_string()),
                restored_files: Vec::new(),
                can_undo: self.can_undo(),
                can_redo: false,
            });
        }

        // Move pointer forward first
        self.index.current_index += 1;

        // Clone the entry to avoid borrow checker issues
        let entry = self.index.entries[self.index.current_index as usize].clone();
        info!("⏩ [EDIT_HISTORY] Redoing edit: {}", entry.id);

        let mut restored_files = Vec::new();

        // Restore each file to its "after" state
        for change in &entry.changes {
            let before_content = self.load_snapshot(&change.before_hash)?;
            let after_content = self.load_snapshot(&change.after_hash)?;

            // Write the "after" content back to the file
            let file_path = self.workflow_path.join(&change.path);
            fs::write(&file_path, &after_content)
                .map_err(|e| format!("Failed to restore file {}: {}", change.path, e))?;

            // For redo: original_content is what was there before redo (before_content)
            restored_files.push(RestoredFile {
                path: change.path.clone(),
                content: after_content.clone(),
                original_content: before_content,
            });

            info!("  ↪️ Restored: {}", change.path);
        }

        self.save_index()?;

        Ok(RestoreResult {
            success: true,
            error: None,
            restored_files,
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
        })
    }

    /// Initialize baseline snapshots for all files in the workflow
    pub fn capture_baseline(&mut self, files: Vec<(String, String)>) -> Result<(), String> {
        info!(
            "📸 [EDIT_HISTORY] Capturing baseline for {} files",
            files.len()
        );

        for (path, content) in files {
            let hash = self.save_snapshot(&content)?;
            debug!("  📄 {}: {}", path, &hash[..16]);
        }

        Ok(())
    }
}

/// Compute line-level diff between two strings using the `similar` crate
/// Returns (added_lines, removed_lines) as 1-indexed line numbers in the NEW content
pub fn compute_line_diff(old_content: &str, new_content: &str) -> (Vec<usize>, Vec<usize>) {
    use similar::{ChangeTag, TextDiff};

    // Normalize line endings to LF before comparison to avoid CRLF vs LF mismatch
    // causing all lines to appear different
    let old_normalized = old_content.replace("\r\n", "\n");
    let new_normalized = new_content.replace("\r\n", "\n");

    let diff = TextDiff::from_lines(&old_normalized, &new_normalized);

    let mut added_lines = Vec::new();
    let mut removed_lines = Vec::new();
    let mut new_line_num = 0usize;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                new_line_num += 1;
            }
            ChangeTag::Insert => {
                new_line_num += 1;
                added_lines.push(new_line_num);
            }
            ChangeTag::Delete => {
                // For removed lines, we track where they would have been
                // Use the current new_line_num + 1 as the reference point
                removed_lines.push(new_line_num + 1);
            }
        }
    }

    (added_lines, removed_lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_content() {
        let hash1 = EditHistory::hash_content("hello");
        let hash2 = EditHistory::hash_content("hello");
        let hash3 = EditHistory::hash_content("world");

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_compute_line_diff() {
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3\nline4";

        let (added, removed) = compute_line_diff(old, new);

        assert!(added.contains(&2)); // line2 -> modified
        assert!(added.contains(&4)); // new line4
        assert!(removed.contains(&2)); // original line2
    }
}
