import { invoke } from "@tauri-apps/api/core";
import { Pencil, Trash2, Copy, FilePlus, FolderPlus, ExternalLink } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export interface FileContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

interface FileContextMenuProps {
  children: React.ReactNode;
  filePath: string;
  fileName: string;
  isDirectory: boolean;
  workflowPath?: string;
  onRefresh?: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Build full Windows path from workflow path and relative file path
 */
function getFullPath(workflowPath: string | undefined, filePath: string): string {
  const basePath = workflowPath || "";
  const combined = basePath ? `${basePath}/${filePath}` : filePath;
  // Convert to Windows backslashes
  return combined.replace(/\//g, "\\");
}

/**
 * Context menu for file operations in the file tree.
 * Right-click to show rename, delete, duplicate, reveal in explorer options.
 * All operations call Tauri commands directly.
 */
export function FileContextMenu({
  children,
  filePath,
  fileName,
  isDirectory,
  workflowPath,
  onRefresh,
  className,
  disabled,
}: FileContextMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [newName, setNewName] = React.useState(fileName);
  const [isCreatingFile, setIsCreatingFile] = React.useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setPosition({ x: e.clientX, y: e.clientY });
      setIsOpen(true);
    },
    [disabled]
  );

  const handleClose = React.useCallback(() => {
    setIsOpen(false);
    setIsRenaming(false);
    setIsCreatingFile(false);
    setIsCreatingFolder(false);
    setNewName(fileName);
    setCreateName("");
  }, [fileName]);

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, handleClose]);

  // Adjust position if menu would go off-screen
  React.useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let newX = position.x;
    let newY = position.y;

    if (position.x + rect.width > viewportWidth) {
      newX = viewportWidth - rect.width - 8;
    }
    if (position.y + rect.height > viewportHeight) {
      newY = viewportHeight - rect.height - 8;
    }

    if (newX !== position.x || newY !== position.y) {
      setPosition({ x: newX, y: newY });
    }
  }, [isOpen, position]);

  // Focus input when renaming or creating starts
  React.useEffect(() => {
    if ((isRenaming || isCreatingFile || isCreatingFolder) && inputRef.current) {
      inputRef.current.focus();
      if (isRenaming) {
        // Select the name without extension
        const dotIndex = fileName.lastIndexOf(".");
        if (dotIndex > 0 && !isDirectory) {
          inputRef.current.setSelectionRange(0, dotIndex);
        } else {
          inputRef.current.select();
        }
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming, isCreatingFile, isCreatingFolder, fileName, isDirectory]);

  const handleRevealInExplorer = React.useCallback(async () => {
    try {
      const fullPath = getFullPath(workflowPath, filePath);
      await invoke("reveal_in_explorer", { path: fullPath });
    } catch (err) {
      console.error("Failed to reveal in explorer:", err);
    }
    handleClose();
  }, [filePath, workflowPath, handleClose]);

  const handleRenameStart = React.useCallback(() => {
    setIsRenaming(true);
    setNewName(fileName);
  }, [fileName]);

  const handleRenameSubmit = React.useCallback(
    async (value?: string) => {
      const name = (value ?? newName).trim();
      if (!name || name === fileName) {
        handleClose();
        return;
      }
      try {
        const fullPath = getFullPath(workflowPath, filePath);
        const pathParts = fullPath.split("\\");
        pathParts[pathParts.length - 1] = name;
        await invoke("rename_file", { oldPath: fullPath, newPath: pathParts.join("\\") });
        onRefresh?.();
      } catch (err) {
        console.error("Failed to rename:", err);
      }
      handleClose();
    },
    [filePath, workflowPath, newName, fileName, handleClose, onRefresh]
  );

  // Show delete confirmation dialog
  const handleDeleteClick = React.useCallback(() => {
    handleClose();
    setShowDeleteConfirm(true);
  }, [handleClose]);

  // Actually perform the delete after confirmation
  const handleConfirmDelete = React.useCallback(async () => {
    setIsDeleting(true);
    try {
      const fullPath = getFullPath(workflowPath, filePath);
      await invoke("delete_file", { path: fullPath, toTrash: true });
      onRefresh?.();
    } catch (err) {
      console.error("Failed to delete:", err);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [filePath, workflowPath, onRefresh]);

  const handleDuplicate = React.useCallback(async () => {
    try {
      const fullPath = getFullPath(workflowPath, filePath);
      await invoke("duplicate_file", { path: fullPath });
      onRefresh?.();
    } catch (err) {
      console.error("Failed to duplicate:", err);
    }
    handleClose();
  }, [filePath, workflowPath, handleClose, onRefresh]);

  const handleNewFileStart = React.useCallback(() => {
    setIsCreatingFile(true);
    setCreateName("new-file.ts");
  }, []);

  const handleNewFolderStart = React.useCallback(() => {
    setIsCreatingFolder(true);
    setCreateName("new-folder");
  }, []);

  const handleCreateSubmit = React.useCallback(async () => {
    if (!createName.trim()) {
      handleClose();
      return;
    }

    try {
      // Get parent directory path
      const parentPath = isDirectory ? filePath : filePath.split("/").slice(0, -1).join("/");
      const fullParentPath = getFullPath(workflowPath, parentPath);
      // Build full path for the new file/folder
      const fullNewPath = fullParentPath ? `${fullParentPath}\\${createName.trim()}` : createName.trim();

      if (isCreatingFile) {
        await invoke("create_file", { path: fullNewPath, content: null });
      } else if (isCreatingFolder) {
        await invoke("create_folder", { path: fullNewPath });
      }
      onRefresh?.();
    } catch (err) {
      console.error("Failed to create:", err);
    }
    handleClose();
  }, [filePath, workflowPath, isDirectory, isCreatingFile, isCreatingFolder, createName, handleClose, onRefresh]);

  const menuItems: FileContextMenuItem[] = React.useMemo(() => {
    const items: FileContextMenuItem[] = [];

    // New File
    items.push({
      label: "New File",
      icon: <FilePlus className="w-4 h-4" />,
      onClick: handleNewFileStart,
    });

    // New Folder
    items.push({
      label: "New Folder",
      icon: <FolderPlus className="w-4 h-4" />,
      onClick: handleNewFolderStart,
    });

    // Separator
    items.push({ label: "", onClick: () => {}, separator: true });

    // Rename
    items.push({
      label: "Rename",
      icon: <Pencil className="w-4 h-4" />,
      onClick: handleRenameStart,
    });

    // Duplicate (only for files)
    if (!isDirectory) {
      items.push({
        label: "Duplicate",
        icon: <Copy className="w-4 h-4" />,
        onClick: handleDuplicate,
      });
    }

    // Reveal in Explorer
    items.push({
      label: "Reveal in Explorer",
      icon: <ExternalLink className="w-4 h-4" />,
      onClick: handleRevealInExplorer,
    });

    // Separator before delete
    items.push({ label: "", onClick: () => {}, separator: true });

    // Delete
    items.push({
      label: "Delete",
      icon: <Trash2 className="w-4 h-4" />,
      onClick: handleDeleteClick,
      danger: true,
    });

    return items;
  }, [
    isDirectory,
    handleRenameStart,
    handleDeleteClick,
    handleDuplicate,
    handleRevealInExplorer,
    handleNewFileStart,
    handleNewFolderStart,
  ]);

  // Determine what input mode we're in
  const isInputMode = isRenaming || isCreatingFile || isCreatingFolder;
  const inputValue = isRenaming ? newName : createName;
  const setInputValue = isRenaming ? setNewName : setCreateName;
  const handleInputSubmit = isRenaming ? handleRenameSubmit : handleCreateSubmit;
  const inputPlaceholder = isCreatingFile ? "File name" : isCreatingFolder ? "Folder name" : "New name";
  const deleteDescription = isDirectory
    ? `Are you sure you want to delete the folder "${fileName}" and all its contents? This will move it to the trash.`
    : `Are you sure you want to delete "${fileName}"? This will move it to the trash.`;

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isRenaming) {
        setNewName(e.target.value);
      } else {
        setCreateName(e.target.value);
      }
    },
    [isRenaming]
  );

  const handleInputKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = e.currentTarget.value;
        if (isRenaming) {
          setNewName(value);
          handleRenameSubmit(value);
        } else {
          setCreateName(value);
          value.trim() ? handleCreateSubmit() : handleClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    },
    [isRenaming, handleRenameSubmit, handleCreateSubmit, handleClose]
  );

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {children}

      {isOpen && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm"
          style={{ left: position.x, top: position.y }}
        >
          {isInputMode ? (
            <div className="px-2 py-1" onMouseDown={e => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                onBlur={() => handleInputSubmit()}
                placeholder={inputPlaceholder}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ) : (
            menuItems.map((item, index) =>
              item.separator ? (
                <div key={index} className="h-px bg-gray-200 my-1" />
              ) : (
                <button
                  key={index}
                  className={cn(
                    "w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-gray-100 transition-colors",
                    item.disabled && "opacity-50 cursor-not-allowed",
                    item.danger && "text-red-600 hover:bg-red-50"
                  )}
                  onClick={item.onClick}
                  disabled={item.disabled}
                >
                  {item.icon}
                  {item.label}
                </button>
              )
            )
          )}
        </div>
      )}
      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        isLoading={isDeleting}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleConfirmDelete}
        title={isDirectory ? "Delete Folder" : "Delete File"}
        description={deleteDescription}
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  );
}
