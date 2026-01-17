/**
 * ShortcutHint Component
 *
 * Displays a keyboard shortcut badge.
 */

import React from "react";
import { getShortcutLabel } from "@/hooks/useShortcuts";

interface ShortcutHintProps {
  /** The keyboard shortcut key */
  shortcut: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional class names */
  className?: string;
}

export function ShortcutHint({ shortcut, size = "sm", className = "" }: ShortcutHintProps) {
  const label = getShortcutLabel(shortcut);

  const sizeClasses = {
    sm: "min-w-[20px] h-5 px-1.5 text-[10px]",
    md: "min-w-[24px] h-6 px-2 text-xs",
  };

  return (
    <kbd
      className={`
        inline-flex items-center justify-center
        font-mono font-medium
        rounded border
        bg-neutral-100 dark:bg-neutral-800
        border-neutral-300 dark:border-neutral-600
        text-neutral-500 dark:text-neutral-400
        shadow-sm
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {label}
    </kbd>
  );
}
