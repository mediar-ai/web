/**
 * Elicitation Constants
 *
 * Keyboard shortcuts, timing, colors, and configuration.
 */

import { QuestionType, QuestionTypeConfig, QuickAction } from "./types";

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

export const SHORTCUTS = {
  // Option selection (1-9 for enum options)
  OPTION_KEYS: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],

  // Actions
  SUBMIT: "Enter",
  SKIP: "s",
  CANCEL: "Escape",
  HELP: "h",
  RETRY: "r",
  UNDO: "z",

  // Navigation
  NEXT_FIELD: "Tab",
  PREV_FIELD: "Shift+Tab",
  ACCEPT_SUGGESTION: "Enter", // When AI has suggestion
} as const;

// Display-friendly shortcut labels
export const SHORTCUT_LABELS: Record<string, string> = {
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  s: "S",
  h: "H",
  r: "R",
  z: "Z",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};

// ============================================================================
// Animation Timing (ms)
// ============================================================================

export const TIMING = {
  // Modal animations
  MODAL_ENTER: 200,
  MODAL_EXIT: 150,
  BACKDROP_FADE: 150,

  // Content stagger
  STAGGER_DELAY: 50,

  // Feedback
  SELECTION_PULSE: 200,
  SUCCESS_DELAY: 300, // Delay before closing after success

  // Auto-dismiss
  TOAST_DURATION: 3000,
  SHORTCUT_HINT_FADE: 5000, // Fade shortcuts after first use

  // Debounce
  INPUT_DEBOUNCE: 150,
} as const;

// ============================================================================
// Question Type Configurations
// ============================================================================

export const QUESTION_TYPE_CONFIGS: Record<QuestionType, QuestionTypeConfig> = {
  error: {
    type: "error",
    icon: "AlertTriangle",
    title: "Something needs your attention",
    accentColor: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  clarify: {
    type: "clarify",
    icon: "HelpCircle",
    title: "Quick clarification needed",
    accentColor: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
  },
  question: {
    type: "question",
    icon: "MessageCircle",
    title: "Help me understand",
    accentColor: "text-neutral-700 dark:text-neutral-300",
    bgColor: "bg-neutral-500/10",
    borderColor: "border-neutral-300 dark:border-neutral-700",
  },
};

// ============================================================================
// Quick Actions (for error recovery)
// ============================================================================

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "retry",
    label: "Retry",
    icon: "RotateCcw",
    shortcut: "r",
    action: "accept",
    content: { _action: "retry" },
  },
  {
    id: "skip",
    label: "Skip",
    icon: "SkipForward",
    shortcut: "s",
    action: "decline",
  },
  {
    id: "help",
    label: "Help",
    icon: "HelpCircle",
    shortcut: "h",
    action: "accept",
    content: { _action: "help" },
  },
];

// ============================================================================
// Memory & Storage
// ============================================================================

export const STORAGE_KEYS = {
  MEMORY: "elicitation_memory",
  PREFERENCES: "elicitation_preferences",
  SHORTCUT_HINTS_SHOWN: "elicitation_shortcuts_shown",
} as const;

export const MEMORY_CONFIG = {
  MAX_ENTRIES: 100,
  EXPIRY_DAYS: 30,
} as const;

// ============================================================================
// Confidence Thresholds
// ============================================================================

export const CONFIDENCE = {
  HIGH: 0.9, // Auto-accept if user enabled
  MEDIUM: 0.7, // Show as recommended
  LOW: 0.5, // Show but don't highlight
} as const;

// ============================================================================
// Accessibility
// ============================================================================

export const A11Y = {
  MODAL_ROLE: "dialog",
  MODAL_LABEL: "AI needs your input",
  LIVE_REGION: "polite",
} as const;

// ============================================================================
// Z-Index Layers
// ============================================================================

export const Z_INDEX = {
  BACKDROP: 50,
  MODAL: 51,
  TOAST: 52,
} as const;
