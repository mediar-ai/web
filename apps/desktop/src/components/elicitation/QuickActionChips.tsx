/**
 * QuickActionChips Component
 *
 * Quick action buttons for common responses (retry, skip, help).
 */

import React from "react";
import { RotateCcw, SkipForward, HelpCircle } from "lucide-react";
import { ShortcutHint } from "./ShortcutHint";
import { SHORTCUTS } from "@/lib/elicitation/constants";

interface QuickActionChipsProps {
  onRetry?: () => void;
  onSkip?: () => void;
  onHelp?: () => void;
  disabled?: boolean;
}

export function QuickActionChips({ onRetry, onSkip, onHelp, disabled }: QuickActionChipsProps) {
  const actions = [
    {
      id: "retry",
      label: "Retry",
      icon: RotateCcw,
      shortcut: SHORTCUTS.RETRY,
      onClick: onRetry,
    },
    {
      id: "skip",
      label: "Skip",
      icon: SkipForward,
      shortcut: SHORTCUTS.SKIP,
      onClick: onSkip,
    },
    {
      id: "help",
      label: "Help",
      icon: HelpCircle,
      shortcut: SHORTCUTS.HELP,
      onClick: onHelp,
    },
  ].filter(a => a.onClick);

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(action => (
        <button
          key={action.id}
          type="button"
          onClick={action.onClick}
          disabled={disabled}
          className="
            inline-flex items-center gap-2
            px-3 py-2 rounded-lg
            border border-neutral-200 dark:border-neutral-700
            bg-white dark:bg-neutral-800
            text-neutral-700 dark:text-neutral-300
            hover:bg-neutral-50 dark:hover:bg-neutral-700
            hover:border-neutral-300 dark:hover:border-neutral-600
            transition-colors duration-150
            disabled:opacity-50 disabled:cursor-not-allowed
            text-sm font-medium
          "
        >
          <action.icon className="w-4 h-4" />
          {action.label}
          <ShortcutHint shortcut={action.shortcut} size="sm" />
        </button>
      ))}
    </div>
  );
}
