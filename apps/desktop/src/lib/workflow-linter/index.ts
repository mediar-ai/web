/**
 * Workflow Linter
 *
 * A CodeMirror-integrated linting system for Mediar workflow files.
 * Detects dangerous patterns and provides inline warnings with quick fixes.
 *
 * ## Usage
 *
 * ```typescript
 * import { workflowLinter, workflowLinterTheme } from "@/lib/workflow-linter";
 * import { lintGutter } from "@codemirror/lint";
 *
 * const extensions = [
 *   javascript({ typescript: true }),
 *   lintGutter(),
 *   workflowLinter(),
 *   workflowLinterTheme,
 * ];
 * ```
 *
 * ## Adding New Rules
 *
 * 1. Create a new file in `src/lib/workflow-linter/` (e.g., `my-rule.ts`)
 * 2. Implement the `LintRule` interface
 * 3. Register with `ruleRegistry.register(myRule)`
 * 4. Import the rule file in `codemirror-extension.ts`
 *
 * @example
 * ```typescript
 * // my-rule.ts
 * import { LintRule, ruleRegistry } from "./rules";
 *
 * export const myRule: LintRule = {
 *   id: "my-rule",
 *   name: "My Custom Rule",
 *   defaultSeverity: "warning",
 *   description: "Detects something bad",
 *   check: (code) => {
 *     const results = [];
 *     // ... detection logic
 *     return results;
 *   },
 * };
 *
 * ruleRegistry.register(myRule);
 * ```
 */

// Core exports
export {
  lintCode,
  ruleRegistry,
  type LintRule,
  type LintResult,
  type LintSeverity,
  type LinterConfig,
  type LintFix,
  type LintAction,
} from "./rules";

// CodeMirror integration
export {
  workflowLinter,
  workflowLinterTheme,
  LINT_ASK_AI_EVENT,
  type LintAskAIEventDetail,
} from "./codemirror-extension";

// Individual rules (importing them ensures they're registered)
export { dangerousKeysRule } from "./dangerous-keys";
