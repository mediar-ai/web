/**
 * useShortcuts Hook
 *
 * Handles keyboard shortcuts for the elicitation modal.
 */

import { useCallback, useEffect } from "react";
import { SHORTCUTS } from "@/lib/elicitation/constants";

interface UseShortcutsOptions {
  /** Whether shortcuts are enabled */
  enabled: boolean;
  /** Callback when an option key (1-9) is pressed */
  onOptionSelect?: (index: number) => void;
  /** Callback when submit is pressed */
  onSubmit?: () => void;
  /** Callback when skip is pressed */
  onSkip?: () => void;
  /** Callback when cancel/escape is pressed */
  onCancel?: () => void;
  /** Callback when retry is pressed */
  onRetry?: () => void;
  /** Callback when help is pressed */
  onHelp?: () => void;
}

export function useShortcuts({
  enabled,
  onOptionSelect,
  onSubmit,
  onSkip,
  onCancel,
  onRetry,
  onHelp,
}: UseShortcutsOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture if user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        // Still allow escape and enter in inputs
        if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && onSubmit) {
          // Only submit on enter if it's a single-line input
          if (target.tagName === "INPUT") {
            event.preventDefault();
            onSubmit();
          }
          return;
        }
        return;
      }

      // Option keys (1-9)
      const optionIndex = (SHORTCUTS.OPTION_KEYS as readonly string[]).indexOf(event.key);
      if (optionIndex !== -1 && onOptionSelect) {
        event.preventDefault();
        onOptionSelect(optionIndex);
        return;
      }

      // Action keys
      switch (event.key.toLowerCase()) {
        case "enter":
          if (onSubmit) {
            event.preventDefault();
            onSubmit();
          }
          break;

        case "escape":
          if (onCancel) {
            event.preventDefault();
            onCancel();
          }
          break;

        case SHORTCUTS.SKIP.toLowerCase():
          if (onSkip) {
            event.preventDefault();
            onSkip();
          }
          break;

        case SHORTCUTS.RETRY.toLowerCase():
          if (onRetry) {
            event.preventDefault();
            onRetry();
          }
          break;

        case SHORTCUTS.HELP.toLowerCase():
          if (onHelp) {
            event.preventDefault();
            onHelp();
          }
          break;
      }
    },
    [enabled, onOptionSelect, onSubmit, onSkip, onCancel, onRetry, onHelp]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}

/**
 * Get the display label for a keyboard shortcut.
 */
export function getShortcutLabel(key: string): string {
  const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

  // Special key mappings
  const labels: Record<string, string> = {
    Enter: "↵",
    Escape: "Esc",
    " ": "Space",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };

  if (labels[key]) return labels[key];

  // Single character - uppercase
  if (key.length === 1) return key.toUpperCase();

  return key;
}
