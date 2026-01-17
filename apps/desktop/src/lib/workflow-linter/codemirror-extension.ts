/**
 * CodeMirror 6 integration for workflow linter
 *
 * Provides a linter extension that runs all registered rules and displays
 * diagnostics inline with quick-fix actions.
 */

import { linter, type Diagnostic, type Action } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { lintCode, type LinterConfig, type LintResult, type LintSeverity } from "./rules";

// Import rules to ensure they're registered
import "./dangerous-keys";

/**
 * Map our severity levels to CodeMirror's
 */
function mapSeverity(severity: LintSeverity): Diagnostic["severity"] {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "hint":
      return "hint";
    default:
      return "warning";
  }
}

/**
 * Custom event for "Ask AI" action - dispatched on the document
 * Listen for this event in your app to handle AI fix requests
 */
export const LINT_ASK_AI_EVENT = "workflow-lint:ask-ai";

export interface LintAskAIEventDetail {
  prompt: string;
  ruleId: string;
  code: string;
  from: number;
  to: number;
}

/**
 * Convert a LintResult to a CodeMirror Diagnostic
 */
function toDiagnostic(result: LintResult, _view: EditorView): Diagnostic {
  const actions: Action[] = [];

  // Add actions from the new actions array
  if (result.actions) {
    for (const action of result.actions) {
      if (action.type === "replace" && action.replacement !== undefined) {
        actions.push({
          name: action.label,
          apply: (view: EditorView, from: number, to: number) => {
            view.dispatch({
              changes: { from, to, insert: action.replacement! },
            });
          },
        });
      } else if (action.type === "ask-ai" && action.prompt) {
        actions.push({
          name: action.label,
          apply: (view: EditorView, from: number, to: number) => {
            const code = view.state.doc.toString();
            const event = new CustomEvent(LINT_ASK_AI_EVENT, {
              bubbles: true,
              detail: {
                prompt: action.prompt,
                ruleId: result.ruleId,
                code: code.slice(from, to),
                from,
                to,
              } satisfies LintAskAIEventDetail,
            });
            view.dom.dispatchEvent(event);
          },
        });
      }
    }
  }

  // Legacy: Add quick fix action if available (backwards compatibility)
  if (result.fix && !result.actions) {
    actions.push({
      name: result.fix.label,
      apply: (view: EditorView, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: result.fix!.replacement },
        });
      },
    });
  }

  return {
    from: result.from,
    to: result.to,
    severity: mapSeverity(result.severity),
    message: result.message,
    source: `workflow-lint:${result.ruleId}`,
    actions: actions.length > 0 ? actions : undefined,
  };
}

/**
 * Create a CodeMirror linter extension for workflow files
 *
 * @param config - Optional linter configuration
 * @returns CodeMirror extension
 *
 * @example
 * ```typescript
 * import { workflowLinter } from "@/lib/workflow-linter";
 *
 * const extensions = [
 *   javascript({ typescript: true }),
 *   lintGutter(),
 *   workflowLinter(),
 * ];
 * ```
 */
export function workflowLinter(config: LinterConfig = {}) {
  return linter(
    view => {
      const code = view.state.doc.toString();
      const results = lintCode(code, config);
      return results.map(result => toDiagnostic(result, view));
    },
    {
      // Delay in ms before linting after changes
      delay: 300,
    }
  );
}

/**
 * Theme for workflow linter diagnostics
 *
 * Provides custom styling for dangerous key warnings
 */
export const workflowLinterTheme = EditorView.baseTheme({
  // Warning underline style (orange/yellow squiggly)
  ".cm-lintRange-warning": {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 2.5 l2 -1.5 l1 0 l2 1.5 l1 0' stroke='%23f59e0b' fill='none' stroke-width='1'/%3E%3C/svg%3E")`,
    backgroundRepeat: "repeat-x",
    backgroundPosition: "bottom left",
    paddingBottom: "2px",
  },
  // Error underline style (red squiggly)
  ".cm-lintRange-error": {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 2.5 l2 -1.5 l1 0 l2 1.5 l1 0' stroke='%23ef4444' fill='none' stroke-width='1'/%3E%3C/svg%3E")`,
    backgroundRepeat: "repeat-x",
    backgroundPosition: "bottom left",
    paddingBottom: "2px",
  },
  // Tooltip styling
  ".cm-tooltip-lint": {
    backgroundColor: "white !important",
    border: "2px solid black",
    borderRadius: "6px",
    boxShadow: "4px 4px 0 rgba(0,0,0,0.8)",
    padding: "12px 16px",
    maxWidth: "420px",
    fontSize: "13px",
    lineHeight: "1.5",
  },
  // Diagnostic message in tooltip - reset any colored backgrounds
  ".cm-diagnostic": {
    padding: "8px 0",
    borderBottom: "1px solid #e5e7eb",
    backgroundColor: "transparent !important",
    borderLeft: "none !important",
  },
  ".cm-diagnostic:last-child": {
    borderBottom: "none",
    paddingBottom: "4px",
  },
  ".cm-diagnostic:first-child": {
    paddingTop: "4px",
  },
  // Override warning/error background colors in tooltip
  ".cm-diagnostic-warning, .cm-diagnostic-error, .cm-diagnostic-info, .cm-diagnostic-hint": {
    backgroundColor: "transparent !important",
    borderLeft: "none !important",
  },
  // Warning icon in gutter
  ".cm-lint-marker-warning": {
    content: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23f59e0b' stroke-width='2'%3E%3Cpath d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/%3E%3Cline x1='12' y1='9' x2='12' y2='13'/%3E%3Cline x1='12' y1='17' x2='12.01' y2='17'/%3E%3C/svg%3E")`,
  },
  // Error icon in gutter
  ".cm-lint-marker-error": {
    content: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23ef4444' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='15' y1='9' x2='9' y2='15'/%3E%3Cline x1='9' y1='9' x2='15' y2='15'/%3E%3C/svg%3E")`,
  },
  // Action button in tooltip
  ".cm-diagnostic-action": {
    backgroundColor: "black",
    color: "white",
    border: "none",
    borderRadius: "4px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: "500",
    cursor: "pointer",
    marginTop: "10px",
    marginRight: "6px",
    transition: "background-color 0.15s",
  },
  ".cm-diagnostic-action:hover": {
    backgroundColor: "#374151",
  },
});
