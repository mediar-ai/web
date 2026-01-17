/**
 * Workflow Diff Utility
 * Types and utilities for displaying workflow changes
 */

import type { SequenceStep } from "./workflow-schema";

export type ChangeType = "added" | "removed" | "modified" | "reordered";

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface StepChange {
  type: ChangeType;
  stepIndex: number;
  stepId?: string;
  stepName?: string;
  toolName: string;
  fieldChanges?: FieldChange[];
  fromIndex?: number; // For reordered steps
  toIndex?: number; // For reordered steps
  // Store previous step for diff display
  previousStep?: SequenceStep;
}

export interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  lineNumber?: number;
}

/**
 * Get change indicator prefix for display
 */
export function getChangeIndicator(type: ChangeType): string {
  switch (type) {
    case "added":
      return "[+]";
    case "removed":
      return "[-]";
    case "modified":
      return "[~]";
    case "reordered":
      return "[↕]";
    default:
      return "";
  }
}

/**
 * Format a field change for display
 */
export function formatFieldChange(change: FieldChange): string {
  const formatValue = (val: unknown): string => {
    if (val === undefined) return "(none)";
    if (val === null) return "null";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  };

  const oldStr = formatValue(change.oldValue);
  const newStr = formatValue(change.newValue);

  if (change.oldValue === undefined) {
    return `${change.field}: ${newStr} (added)`;
  }
  if (change.newValue === undefined) {
    return `${change.field}: (removed)`;
  }
  return `${change.field}: ${oldStr} → ${newStr}`;
}
