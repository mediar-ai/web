/**
 * CodeMirror TypeScript Extensions
 *
 * Provides CodeMirror extensions for TypeScript type checking,
 * autocomplete, hover, and go-to-definition.
 */

import { linter, Diagnostic, Action } from "@codemirror/lint";
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { hoverTooltip, Tooltip, EditorView } from "@codemirror/view";
import { Extension, Facet } from "@codemirror/state";
import { TypeScriptEnvironment, getTypeScriptEnvironment, TsDiagnostic } from "./ts-environment";
import { LINT_ASK_AI_EVENT, type LintAskAIEventDetail } from "@/lib/workflow-linter";

/** Configuration for TypeScript CodeMirror extensions */
export interface TsEditorConfig {
  /** Virtual file name for this editor */
  fileName: string;
  /** Workflow ID for loading type definitions */
  workflowId?: string;
  /** Enable linting (type errors) */
  linting?: boolean;
  /** Enable autocomplete */
  autocomplete?: boolean;
  /** Enable hover tooltips */
  hover?: boolean;
}

/** Facet to store the TypeScript config - must be added to extensions */
export const tsConfigFacet = Facet.define<TsEditorConfig, TsEditorConfig>({
  combine: values => values[0] ?? { fileName: "/main.ts" },
});

/**
 * Build an AI prompt for fixing a TypeScript error
 */
function buildTsFixPrompt(diagnostic: TsDiagnostic, code: string, lineContent: string, contextCode: string): string {
  return `**TypeScript Error: ${diagnostic.code ? `TS${diagnostic.code}` : "Type Error"}**

**Error message:**
\`\`\`
${diagnostic.message}
\`\`\`

**Problematic code:**
\`\`\`typescript
${lineContent.trim()}
\`\`\`

**Context (surrounding code):**
\`\`\`typescript
${contextCode}
\`\`\`

**Please fix this TypeScript error. Consider:**
1. Check if the types are correct - maybe a wrong property name or missing field?
2. Check if imports are correct - maybe a missing import or wrong path?
3. Check the @mediar-ai/workflow SDK patterns:
   - \`createStep({ id, name, execute: async ({ desktop, input, context }) => {...} })\`
   - \`createWorkflow({ input: InputSchema, steps: [...], onError?, onSuccess? })\`
   - \`context.setState({ key: "value" })\` for state management
   - \`desktop.locator('role:Button && name:Submit').click()\` for UI automation
   - \`return success()\`, \`return retry()\`, \`return next("step_id")\` for flow control
4. Check Zod schema patterns for InputSchema if type relates to inputs
5. If using desktop SDK methods, verify the method exists and has correct parameters

**Common fixes:**
- Missing \`await\` on async operations
- Wrong property name (check SDK types)
- Missing or wrong import
- Type mismatch in return values (use \`{ state: {...} }\` pattern)
- Zod schema field type doesn't match usage

Please provide the corrected code.`;
}

/**
 * Create a TypeScript linter for CodeMirror
 *
 * Reports type errors and warnings from the TypeScript compiler.
 */
export function createTsLinter(): Extension {
  return linter(
    async view => {
      try {
        const config = view.state.facet(tsConfigFacet);
        const env = getTypeScriptEnvironment();

        console.log("[TsLinter] Running linter for:", config.fileName, "isReady:", env.isReady());

        if (!env.isReady()) {
          console.log("[TsLinter] Environment not ready, returning empty");
          return [];
        }

        // Update the file content
        const content = view.state.doc.toString();
        env.updateFile(config.fileName, content);

        // Get diagnostics
        const diagnostics = env.getDiagnostics(config.fileName);
        console.log("[TsLinter] Got diagnostics:", diagnostics.length, "for", config.fileName);

        if (diagnostics.length > 0) {
          console.log("[TsLinter] First diagnostic:", diagnostics[0]);
        }

        return diagnostics.map((d: TsDiagnostic): Diagnostic => {
          let from = Math.min(d.from, view.state.doc.length);
          let to = Math.min(d.to, view.state.doc.length);

          // For "expected" errors (like TS1005 "';' expected"), TypeScript reports the position
          // of the unexpected token it found, not where the missing token should be.
          // Adjust to point to the end of the previous line for better UX.
          const expectedErrorCodes = [
            1005, // ';' expected
            1002, // Unterminated string literal
            1003, // Identifier expected
            1009, // Trailing comma not allowed
            1010, // '*/' expected
            1011, // An element access expression should take an argument
            1012, // Unexpected token
            1014, // A rest parameter must be last in a parameter list
            1128, // Declaration or statement expected
            1160, // Unterminated template literal
          ];

          if (d.code && expectedErrorCodes.includes(d.code) && from > 0) {
            // Find the previous non-whitespace position
            let adjustedFrom = from - 1;
            while (adjustedFrom > 0 && (content[adjustedFrom] === "\n" || content[adjustedFrom] === "\r")) {
              adjustedFrom--;
            }
            // Point to the character just before the newline (end of previous line)
            if (adjustedFrom !== from - 1) {
              from = adjustedFrom;
              to = adjustedFrom + 1;
            }
          }

          // Get line content for the error
          const lineStart = content.lastIndexOf("\n", from) + 1;
          const lineEnd = content.indexOf("\n", to);
          const lineContent = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);

          // Get surrounding context (5 lines before and after)
          const lines = content.split("\n");
          const currentLineNum = content.slice(0, lineStart).split("\n").length - 1;
          const contextStart = Math.max(0, currentLineNum - 5);
          const contextEnd = Math.min(lines.length, currentLineNum + 6);
          const contextCode = lines.slice(contextStart, contextEnd).join("\n");

          // Build the AI prompt
          const aiPrompt = buildTsFixPrompt(d, content, lineContent, contextCode);

          // Create the "Fix with AI" action
          const actions: Action[] = [
            {
              name: "Fix with AI",
              apply: (editorView: EditorView) => {
                const event = new CustomEvent(LINT_ASK_AI_EVENT, {
                  bubbles: true,
                  detail: {
                    prompt: aiPrompt,
                    ruleId: d.code ? `ts${d.code}` : "typescript",
                    code: content.slice(from, to),
                    from,
                    to,
                  } satisfies LintAskAIEventDetail,
                });
                editorView.dom.dispatchEvent(event);
              },
            },
          ];

          return {
            from,
            to,
            severity: d.severity,
            message: d.message,
            source: d.code ? `ts(${d.code})` : "typescript",
            actions,
          };
        });
      } catch (err) {
        console.error("[TsLinter] Error in linter:", err);
        return [];
      }
    },
    {
      delay: 500, // Debounce to avoid too frequent checks
    }
  );
}

/**
 * Create TypeScript autocomplete for CodeMirror
 */
export function createTsAutocomplete(): Extension {
  return autocompletion({
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        const config = context.state.facet(tsConfigFacet);
        const env = getTypeScriptEnvironment();

        if (!env.isReady()) {
          return null;
        }

        // Update the file content
        const content = context.state.doc.toString();
        env.updateFile(config.fileName, content);

        // Get completions
        const completions = env.getCompletions(config.fileName, context.pos);

        if (completions.length === 0) {
          return null;
        }

        return {
          from: context.pos,
          options: completions.map(c => ({
            label: c.label,
            type: c.kind.toLowerCase(),
            detail: c.detail,
            apply: c.insertText,
          })),
        };
      },
    ],
  });
}

/** Map TypeScript display part kinds to CSS colors - minimal black/white with subtle accents */
function getColorForKind(kind: string): { color: string; style?: string } {
  switch (kind) {
    case "keyword":
      return { color: "#000", style: "bold" }; // bold black for keywords
    case "interfaceName":
    case "className":
    case "enumName":
    case "aliasName":
      return { color: "#000", style: "bold" }; // bold black for type names
    case "typeParameterName":
      return { color: "#666", style: "italic" }; // italic gray for generics <T>
    case "methodName":
    case "functionName":
      return { color: "#1a1a1a" }; // near-black for methods
    case "parameterName":
      return { color: "#0066cc" }; // single accent: blue for parameters (the important part)
    case "propertyName":
    case "localName":
      return { color: "#333" }; // dark gray
    case "stringLiteral":
      return { color: "#22863a" }; // subtle green for strings
    case "numericLiteral":
      return { color: "#005cc5" }; // blue for numbers
    case "punctuation":
      return { color: "#999" }; // light gray - de-emphasized
    case "operator":
      return { color: "#666" }; // medium gray
    case "text":
    case "space":
    case "lineBreak":
    default:
      return { color: "inherit" };
  }
}

/** Render markdown-like documentation to HTML */
function renderDocumentation(text: string): HTMLElement {
  const container = document.createElement("div");

  // Split into paragraphs
  const parts = text.split(/\n\n+/);

  for (const part of parts) {
    // Check if it's a code block
    if (part.startsWith("```")) {
      const codeMatch = part.match(/```(\w*)\n?([\s\S]*?)```/);
      if (codeMatch) {
        const pre = document.createElement("pre");
        pre.style.cssText = `
          background: #f5f5f5;
          padding: 10px 12px;
          border-radius: 6px;
          margin: 8px 0;
          overflow-x: auto;
          font-size: 11px;
          font-family: "JetBrains Mono", ui-monospace, monospace;
          color: #333;
          border: 1px solid #eee;
        `;
        const code = document.createElement("code");
        code.textContent = codeMatch[2].trim();
        pre.appendChild(code);
        container.appendChild(pre);
      }
    } else {
      const p = document.createElement("p");
      p.style.margin = "4px 0";

      // Render inline code and links
      let html = part
        // Inline code: `code`
        .replace(
          /`([^`]+)`/g,
          '<code style="background:#f0f0f0;padding:2px 5px;border-radius:4px;font-size:11px;font-family:ui-monospace,monospace;color:#333;">$1</code>'
        )
        // Links: {@link name} or {@linkcode name}
        .replace(
          /\{@link(?:code)?\s+([^}]+)\}/g,
          '<code style="background:#f0f0f0;padding:2px 5px;border-radius:4px;font-size:11px;font-family:ui-monospace,monospace;color:#0066cc;">$1</code>'
        )
        // Basic markdown links [text](url) - but don't make them clickable for security
        .replace(
          /\[([^\]]+)\]\([^)]+\)/g,
          '<code style="background:#f0f0f0;padding:2px 5px;border-radius:4px;font-size:11px;font-family:ui-monospace,monospace;">$1</code>'
        );

      p.innerHTML = html;
      container.appendChild(p);
    }
  }

  return container;
}

/**
 * Create TypeScript hover tooltips for CodeMirror
 */
export function createTsHover(): Extension {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const config = view.state.facet(tsConfigFacet);
      const env = getTypeScriptEnvironment();

      if (!env.isReady()) {
        return null;
      }

      // Update the file content
      const content = view.state.doc.toString();
      env.updateFile(config.fileName, content);

      // Get hover info
      const info = env.getHoverInfo(config.fileName, pos);

      if (!info) {
        return null;
      }

      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-ts-hover";
          dom.style.cssText = `
            padding: 12px 16px;
            max-width: 560px;
            font-size: 13px;
            line-height: 1.6;
            background: #fafafa;
            border: 1px solid #e5e5e5;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          `;

          const code = document.createElement("code");
          code.style.cssText = `
            display: block;
            white-space: pre-wrap;
            font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
            font-size: 12px;
            line-height: 1.7;
            color: #1a1a1a;
          `;

          // Render with syntax highlighting using displayParts
          if (info.displayParts && info.displayParts.length > 0) {
            let paramDepth = 0;
            for (let i = 0; i < info.displayParts.length; i++) {
              const part = info.displayParts[i];
              const span = document.createElement("span");
              span.textContent = part.text;
              const styling = getColorForKind(part.kind);
              if (styling.color !== "inherit") {
                span.style.color = styling.color;
              }
              if (styling.style === "bold") {
                span.style.fontWeight = "600";
              }
              if (styling.style === "italic") {
                span.style.fontStyle = "italic";
              }
              code.appendChild(span);

              // Add line breaks after commas in parameter lists for readability
              if (part.text === "(") paramDepth++;
              if (part.text === ")") paramDepth--;
              if (part.text === "," && paramDepth === 1) {
                code.appendChild(document.createTextNode("\n    "));
              }
            }
          } else {
            // Fallback to plain text
            code.textContent = info.text;
          }

          dom.appendChild(code);

          if (info.documentation) {
            const docDiv = document.createElement("div");
            docDiv.style.cssText = `
              margin-top: 10px;
              padding-top: 10px;
              border-top: 1px solid #eaeaea;
              color: #555;
              font-size: 12px;
              line-height: 1.6;
            `;
            docDiv.appendChild(renderDocumentation(info.documentation));
            dom.appendChild(docDiv);
          }

          return { dom };
        },
      };
    },
    {
      hideOnChange: true,
    }
  );
}

/**
 * Initialize TypeScript environment and create all extensions
 *
 * @param config - Editor configuration
 * @returns Array of CodeMirror extensions
 */
export async function createTsExtensions(config: TsEditorConfig): Promise<Extension[]> {
  const env = getTypeScriptEnvironment();

  // Initialize the environment if needed
  if (!env.isReady()) {
    await env.initialize(config.workflowId);
  }

  const extensions: Extension[] = [tsConfigFacet.of(config)];

  if (config.linting !== false) {
    extensions.push(createTsLinter());
  }

  if (config.autocomplete !== false) {
    extensions.push(createTsAutocomplete());
  }

  if (config.hover !== false) {
    extensions.push(createTsHover());
  }

  return extensions;
}

/**
 * Sync editor content to TypeScript environment
 *
 * Call this when the editor content changes to keep the TS environment in sync.
 */
export function syncToTypeScript(fileName: string, content: string): void {
  const env = getTypeScriptEnvironment();
  if (env.isReady()) {
    env.updateFile(fileName, content);
  }
}
