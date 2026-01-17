/**
 * OptionCard Component
 *
 * A selectable option card with keyboard shortcut support.
 */

import React from "react";
import { Check, Sparkles } from "lucide-react";
import { ShortcutHint } from "./ShortcutHint";

interface OptionCardProps {
  /** The option value */
  value: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Whether this option is selected */
  selected: boolean;
  /** Whether this is the AI-recommended option */
  recommended?: boolean;
  /** Keyboard shortcut for this option */
  shortcut?: string;
  /** Callback when option is selected */
  onSelect: () => void;
  /** Whether the card is disabled */
  disabled?: boolean;
}

export function OptionCard({
  value,
  label,
  description,
  selected,
  recommended,
  shortcut,
  onSelect,
  disabled,
}: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`
        w-full text-left
        relative flex items-center gap-3
        px-4 py-3 rounded-lg
        border-2 transition-all duration-150
        ${
          selected
            ? "border-blue-500 bg-blue-500/10 dark:bg-blue-500/20"
            : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${!selected && !disabled ? "hover:bg-neutral-50 dark:hover:bg-neutral-800/50" : ""}
        group
      `}
    >
      {/* Radio indicator */}
      <div
        className={`
          flex-shrink-0 w-5 h-5 rounded-full border-2
          flex items-center justify-center
          transition-all duration-150
          ${selected ? "border-blue-500 bg-blue-500" : "border-neutral-300 dark:border-neutral-600"}
        `}
      >
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`
              font-medium
              ${selected ? "text-blue-600 dark:text-blue-400" : "text-neutral-900 dark:text-neutral-100"}
            `}
          >
            {label}
          </span>
          {recommended && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              <Sparkles className="w-3 h-3" />
              Recommended
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400 truncate">{description}</p>}
      </div>

      {/* Shortcut hint */}
      {shortcut && (
        <div
          className={`
            flex-shrink-0 transition-opacity duration-150
            ${selected ? "opacity-50" : "opacity-100 group-hover:opacity-100"}
          `}
        >
          <ShortcutHint shortcut={shortcut} />
        </div>
      )}
    </button>
  );
}
