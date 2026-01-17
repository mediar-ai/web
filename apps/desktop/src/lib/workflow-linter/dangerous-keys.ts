/**
 * Dangerous key combinations detection rule
 *
 * Detects hotkeys that could crash the Mediar app or cause unintended behavior:
 * - Alt+F4: Closes active window (crashes Mediar if focused)
 * - Ctrl+W: Closes tab/window
 * - Ctrl+Q: Quits application
 * - Ctrl+Alt+Delete: System interrupt
 * - Cmd+W, Cmd+Q: macOS equivalents
 */

import type { LintRule, LintResult, LintAction } from "./rules";
import { ruleRegistry } from "./rules";

interface DangerousKey {
  /** Patterns to match (case-insensitive) */
  patterns: RegExp[];
  /** Human-readable key name */
  displayName: string;
  /** Why this is dangerous */
  reason: string;
  /** Suggested alternative */
  suggestion: string;
  /** Severity level */
  severity: "error" | "warning";
}

const DANGEROUS_KEYS: DangerousKey[] = [
  {
    patterns: [/\{Alt\}\s*\{F4\}/i, /\{Alt\}\s*F4/i, /Alt\s*\+\s*F4/i, /altf4/i, /"alt\+f4"/i, /'alt\+f4'/i],
    displayName: "Alt+F4",
    reason: "Closes the active window. Will crash Mediar if it has focus.",
    suggestion: "Click the close button instead: desktop.locator('role:Button && name:Close').click()",
    severity: "error",
  },
  {
    patterns: [
      /\{Ctrl\}\s*w(?!\w)/i,
      /\{Control\}\s*w(?!\w)/i,
      /Ctrl\s*\+\s*W/i,
      /Control\s*\+\s*W/i,
      /"ctrl\+w"/i,
      /'ctrl\+w'/i,
    ],
    displayName: "Ctrl+W",
    reason: "Closes the current tab or window in most applications.",
    suggestion: "Click the close/X button instead for reliable automation",
    severity: "warning",
  },
  {
    patterns: [
      /\{Ctrl\}\s*q(?!\w)/i,
      /\{Control\}\s*q(?!\w)/i,
      /Ctrl\s*\+\s*Q/i,
      /Control\s*\+\s*Q/i,
      /"ctrl\+q"/i,
      /'ctrl\+q'/i,
    ],
    displayName: "Ctrl+Q",
    reason: "Quits the application in many programs.",
    suggestion: "Use File > Exit or click close button instead",
    severity: "warning",
  },
  {
    patterns: [
      /\{Cmd\}\s*w(?!\w)/i,
      /\{Command\}\s*w(?!\w)/i,
      /Cmd\s*\+\s*W/i,
      /Command\s*\+\s*W/i,
      /"cmd\+w"/i,
      /'cmd\+w'/i,
    ],
    displayName: "Cmd+W",
    reason: "Closes the current window on macOS.",
    suggestion: "Click the close button instead for reliable automation",
    severity: "warning",
  },
  {
    patterns: [
      /\{Cmd\}\s*q(?!\w)/i,
      /\{Command\}\s*q(?!\w)/i,
      /Cmd\s*\+\s*Q/i,
      /Command\s*\+\s*Q/i,
      /"cmd\+q"/i,
      /'cmd\+q'/i,
    ],
    displayName: "Cmd+Q",
    reason: "Quits the application on macOS.",
    suggestion: "Use menu quit or click close button instead",
    severity: "warning",
  },
  {
    patterns: [
      /\{Ctrl\}\s*\{Alt\}\s*\{Delete\}/i,
      /\{Control\}\s*\{Alt\}\s*\{Delete\}/i,
      /Ctrl\s*\+\s*Alt\s*\+\s*Del/i,
      /"ctrl\+alt\+del/i,
    ],
    displayName: "Ctrl+Alt+Delete",
    reason: "Triggers system security screen, interrupts automation.",
    suggestion: "This key combination should never be used in automation",
    severity: "error",
  },
  {
    patterns: [/\{Ctrl\}\s*\{Shift\}\s*\{Esc(?:ape)?\}/i, /Ctrl\s*\+\s*Shift\s*\+\s*Esc/i],
    displayName: "Ctrl+Shift+Esc",
    reason: "Opens Task Manager, interrupts automation flow.",
    suggestion: "Avoid using system shortcuts in workflows",
    severity: "warning",
  },
];

/**
 * Patterns that indicate a key press function call
 * We look for these to scope our dangerous key search
 */
const KEY_PRESS_PATTERNS = [
  // SDK methods - include closing paren so fix placement works correctly
  /\.pressKey\s*\(\s*(['"`])(.*?)\1\s*\)/g,
  /\.pressKeyGlobal\s*\(\s*(['"`])(.*?)\1\s*\)/g,
  // MCP tool calls
  /press_key['"]\s*[,:].*?['"`](.*?)['"`]/g,
  /press_key_global['"]\s*[,:].*?['"`](.*?)['"`]/g,
  // Generic key argument patterns
  /key['"]\s*:\s*['"`](.*?)['"`]/g,
];

/**
 * Check if a position in code is inside a comment
 */
function isInComment(code: string, position: number): boolean {
  const lineStart = code.lastIndexOf("\n", position) + 1;
  const lineContent = code.slice(lineStart, position);
  // Check for single-line comment
  if (lineContent.includes("//")) return true;
  // Check for block comment (simplified - doesn't handle nested)
  const beforePosition = code.slice(0, position);
  const lastBlockStart = beforePosition.lastIndexOf("/*");
  const lastBlockEnd = beforePosition.lastIndexOf("*/");
  if (lastBlockStart > lastBlockEnd) return true;
  return false;
}

function checkDangerousKeys(code: string): LintResult[] {
  const results: LintResult[] = [];

  // First, find all key press calls and extract the key argument
  for (const pattern of KEY_PRESS_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      // Skip matches inside comments
      if (isInComment(code, match.index)) continue;

      // Get the full match and the captured key value
      const fullMatch = match[0];
      const keyValue = match[2] || match[1]; // Depends on capture groups

      if (!keyValue) continue;

      // Check if this key value matches any dangerous pattern
      for (const dangerousKey of DANGEROUS_KEYS) {
        for (const dangerPattern of dangerousKey.patterns) {
          if (dangerPattern.test(keyValue) || dangerPattern.test(fullMatch)) {
            // Find the exact position in the original code
            const matchStart = match.index;
            const matchEnd = matchStart + fullMatch.length;

            // Find line boundaries for "Comment out" fix
            const lineStart = code.lastIndexOf("\n", matchStart) + 1;
            const lineEnd = code.indexOf("\n", matchEnd);
            const lineContent = code.slice(lineStart, lineEnd === -1 ? code.length : lineEnd);
            const indent = lineContent.match(/^(\s*)/)?.[1] || "";

            // Get surrounding context (5 lines before and after)
            const lines = code.split("\n");
            const currentLineNum = code.slice(0, lineStart).split("\n").length - 1;
            const contextStart = Math.max(0, currentLineNum - 5);
            const contextEnd = Math.min(lines.length, currentLineNum + 6);
            const contextLines = lines.slice(contextStart, contextEnd);
            const contextCode = contextLines.join("\n");

            // Build detailed AI prompt
            const aiPrompt = `⚠️ **Dangerous Hotkey Detected: ${dangerousKey.displayName}**

I found this potentially dangerous keyboard shortcut in the workflow code:

\`\`\`typescript
${lineContent.trim()}
\`\`\`

**Why this is dangerous:**
${dangerousKey.reason}

**Context (surrounding code):**
\`\`\`typescript
${contextCode}
\`\`\`

**Please analyze and fix this code. Consider:**
1. Is ${dangerousKey.displayName} actually needed here, or is there a safer alternative?
2. If closing a tab/window is the goal, can we click the close button (X) instead?
3. Is there proper focus verification before this key press? The wrong window might have focus.
4. Are there sufficient delays to ensure the target element is ready?
5. Could this accidentally close the Mediar app if it has focus?

**Suggested safer alternatives:**
- ${dangerousKey.suggestion}
- Add explicit focus checks before key presses
- Use element.click() on close buttons instead of keyboard shortcuts
- Add error handling in case the wrong window receives the key press

Please provide a fixed version of this code that accomplishes the same goal safely.`;

            const actions: LintAction[] = [
              {
                label: "Comment out",
                type: "replace",
                replacement: `${indent}// ${lineContent.trim()} // ⚠️ DANGEROUS: ${dangerousKey.displayName}`,
              },
              {
                label: "Ask AI to fix",
                type: "ask-ai",
                prompt: aiPrompt,
              },
            ];

            results.push({
              from: lineStart,
              to: lineEnd === -1 ? code.length : lineEnd,
              message: `Dangerous hotkey: ${dangerousKey.displayName}\n${dangerousKey.reason}`,
              severity: dangerousKey.severity,
              ruleId: "dangerous-keys",
              actions,
            });

            // Only report once per match
            break;
          }
        }
      }
    }
  }

  // Also do a simple scan for obvious patterns not in function calls
  // This catches things like comments or string literals mentioning these keys
  for (const dangerousKey of DANGEROUS_KEYS) {
    for (const dangerPattern of dangerousKey.patterns) {
      // Create a global version for iteration
      const globalPattern = new RegExp(dangerPattern.source, "gi");
      let match: RegExpExecArray | null;

      while ((match = globalPattern.exec(code)) !== null) {
        // Check if we already reported this position
        const alreadyReported = results.some(r => r.from <= match!.index && r.to >= match!.index + match![0].length);

        if (!alreadyReported) {
          // Only report if it looks like it's in a relevant context (not just a comment explaining it)
          const lineStart = code.lastIndexOf("\n", match.index) + 1;
          const lineContent = code.slice(lineStart, code.indexOf("\n", match.index));

          // Skip if line starts with // (it's already commented)
          if (lineContent.trim().startsWith("//")) continue;

          // Skip if it's in a message/reason string (common in error handling)
          if (/message|reason|description|warning|error/i.test(lineContent)) continue;

          results.push({
            from: match.index,
            to: match.index + match[0].length,
            message: `Potential dangerous hotkey reference: ${dangerousKey.displayName}`,
            severity: "hint" as const,
            ruleId: "dangerous-keys",
          });
        }
      }
    }
  }

  return results;
}

/**
 * Dangerous keys lint rule
 */
export const dangerousKeysRule: LintRule = {
  id: "dangerous-keys",
  name: "Dangerous Hotkeys",
  defaultSeverity: "warning",
  description:
    "Detects keyboard shortcuts that could close windows, quit applications, or interrupt the automation flow.",
  check: checkDangerousKeys,
};

// Auto-register the rule
ruleRegistry.register(dangerousKeysRule);
