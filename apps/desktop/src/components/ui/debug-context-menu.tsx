import { Clipboard, Bug, Terminal, MessageSquare } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface DebugMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface DebugContextMenuProps {
  children: React.ReactNode;
  items: DebugMenuItem[];
  className?: string;
}

/**
 * Debug context menu that appears on Shift+Right-click.
 * Normal right-click shows the browser's default context menu (Copy, Paste, Inspect, etc.)
 */
export function DebugContextMenu({ children, items, className }: DebugContextMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const menuRef = React.useRef<HTMLDivElement>(null);

  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    // Only show debug menu on Shift+Right-click
    // Normal right-click shows browser default (Copy, Paste, Inspect, etc.)
    if (!e.shiftKey) {
      return; // Let browser handle it normally
    }

    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    setIsOpen(true);
  }, []);

  const handleClick = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleItemClick = React.useCallback((item: DebugMenuItem) => {
    if (!item.disabled) {
      item.onClick();
      setIsOpen(false);
    }
  }, []);

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

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

  return (
    <div className={className} onContextMenu={handleContextMenu} onClick={handleClick}>
      {children}

      {isOpen && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[200px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 text-sm"
          style={{ left: position.x, top: position.y }}
        >
          <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 mb-1">
            <Bug className="inline-block w-3 h-3 mr-1" />
            Debug Menu (Shift+Right-click)
          </div>
          {items.map((item, index) => (
            <button
              key={index}
              className={cn(
                "w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
                item.disabled && "opacity-50 cursor-not-allowed"
              )}
              onClick={() => handleItemClick(item)}
              disabled={item.disabled}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Pre-built debug menu items for chat
export function useChatDebugItems(messages: any[], workflowId?: string | null) {
  const copyMessagesToClipboard = React.useCallback(async () => {
    try {
      const formatted = messages
        .map(m => {
          const role = m.role === "user" ? "User" : "Assistant";
          const content = m.content || "";

          // Format tool invocations with their results
          let toolSection = "";
          if (m.toolInvocations?.length) {
            const toolDetails = m.toolInvocations
              .map((t: any) => {
                const name = t.toolName || t.name || "unknown";
                const args = t.args ? JSON.stringify(t.args, null, 2) : "";
                const result = t.result
                  ? `\n      Result: ${typeof t.result === "string" ? t.result.slice(0, 500) : JSON.stringify(t.result, null, 2).slice(0, 500)}`
                  : "";
                const state = t.state ? ` (${t.state})` : "";
                return `    - ${name}${state}${args ? `\n      Args: ${args}` : ""}${result}`;
              })
              .join("\n");
            toolSection = `\n  Tool Calls:\n${toolDetails}`;
          }

          return `[${role}]: ${content}${toolSection}`;
        })
        .join("\n\n---\n\n");

      await navigator.clipboard.writeText(formatted);
      console.log("[DEBUG] Chat history copied to clipboard");
    } catch (err) {
      console.error("[DEBUG] Failed to copy:", err);
    }
  }, [messages]);

  const copyMessagesAsJson = React.useCallback(async () => {
    try {
      const json = JSON.stringify(messages, null, 2);
      await navigator.clipboard.writeText(json);
      console.log("[DEBUG] Chat history (JSON) copied to clipboard");
    } catch (err) {
      console.error("[DEBUG] Failed to copy JSON:", err);
    }
  }, [messages]);

  const logMessagesToConsole = React.useCallback(() => {
    console.group("[DEBUG] Chat Messages");
    console.log("Workflow ID:", workflowId);
    console.log("Message count:", messages.length);
    console.table(
      messages.map(m => ({
        role: m.role,
        contentLength: m.content?.length || 0,
        hasTools: !!m.toolInvocations?.length,
        timestamp: m.timestamp,
      }))
    );
    console.log("Full messages:", messages);
    console.groupEnd();
  }, [messages, workflowId]);

  return React.useMemo(
    () => [
      {
        label: "Copy chat history",
        icon: <Clipboard className="w-4 h-4" />,
        onClick: copyMessagesToClipboard,
        disabled: messages.length === 0,
      },
      {
        label: "Copy as JSON",
        icon: <MessageSquare className="w-4 h-4" />,
        onClick: copyMessagesAsJson,
        disabled: messages.length === 0,
      },
      {
        label: "Log to console",
        icon: <Terminal className="w-4 h-4" />,
        onClick: logMessagesToConsole,
      },
    ],
    [messages.length, copyMessagesToClipboard, copyMessagesAsJson, logMessagesToConsole]
  );
}
