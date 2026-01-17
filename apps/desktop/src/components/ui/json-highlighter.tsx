import { Check, Copy } from "lucide-react";
import React, { memo, useState, useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface JsonHighlighterProps {
  content: string;
  language?: string;
  theme?: "light" | "dark";
  maxHeight?: string;
  showCopyButton?: boolean;
  className?: string;
}

/**
 * Custom UI Tree highlighter - clean, minimal design
 */
const UiTreeHighlighter: React.FC<{ content: string; maxHeight: string; showCopyButton: boolean }> = memo(
  ({ content, maxHeight, showCopyButton }) => {
    const [copied, setCopied] = useState(false);

    const copyToClipboard = async () => {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    };

    const highlightedLines = useMemo(() => {
      return content.split("\n").map((line, i) => {
        const parts: React.ReactNode[] = [];
        let remaining = line;
        let key = 0;

        // Match leading whitespace/indentation
        const indentMatch = remaining.match(/^([\s-]*)/);
        if (indentMatch) {
          // Subtle tree lines
          const indent = indentMatch[1];
          parts.push(
            <span key={key++} className="text-gray-300 select-none">
              {indent}
            </span>
          );
          remaining = remaining.slice(indentMatch[1].length);
        }

        // Match element ID like #1, #2, etc.
        const idMatch = remaining.match(/^(#\d+)\s*/);
        if (idMatch) {
          parts.push(
            <span
              key={key++}
              className="inline-block min-w-[1.25rem] text-center rounded text-[9px] bg-indigo-100 text-indigo-600 font-mono mr-1"
            >
              {idMatch[1]}
            </span>
          );
          remaining = remaining.slice(idMatch[0].length);
        }

        // Match element type in brackets
        const typeMatch = remaining.match(/^\[([^\]]+)\]/);
        if (typeMatch) {
          const elementType = typeMatch[1];
          // Clean color scheme - categorize by function
          let style = "text-violet-500"; // default for unknown types

          // Interactive elements - blue
          if (
            [
              "Button",
              "Hyperlink",
              "Edit",
              "TabItem",
              "CheckBox",
              "RadioButton",
              "ComboBox",
              "Slider",
              "ScrollBar",
              "Spinner",
            ].includes(elementType)
          ) {
            style = "text-blue-600 font-medium";
          }
          // Top-level containers - green bold
          else if (["Window", "Document", "Dialog", "Modal"].includes(elementType)) {
            style = "text-emerald-600 font-semibold";
          }
          // Structural containers - muted
          else if (
            [
              "Pane",
              "Group",
              "List",
              "ListItem",
              "Tab",
              "Panel",
              "Frame",
              "Section",
              "Header",
              "Footer",
              "Navigation",
            ].includes(elementType)
          ) {
            style = "text-slate-400";
          }
          // Content elements - orange
          else if (["Image", "Text", "Label", "Icon", "Paragraph", "Heading"].includes(elementType)) {
            style = "text-orange-500";
          }
          // Toolbars/Menus - purple
          else if (
            ["ToolBar", "Menu", "MenuItem", "MenuBar", "StatusBar", "TitleBar", "Toolbar"].includes(elementType)
          ) {
            style = "text-purple-500";
          }

          parts.push(
            <span key={key++} className={style}>
              {elementType}
            </span>
          );
          remaining = remaining.slice(typeMatch[0].length);
        }

        // Process remaining content
        if (remaining) {
          // Split: name/label vs metadata (bounds, states)
          const metaMatch = remaining.match(/^([^(]*?)(\(bounds:.*)?$/);
          if (metaMatch) {
            const namePart = metaMatch[1];
            const metaPart = metaMatch[2] || "";

            // Name/label
            if (namePart.trim()) {
              parts.push(
                <span key={key++} className="text-slate-700">
                  {namePart}
                </span>
              );
            }

            // States as small badges (hide bounds - too noisy)
            if (metaPart) {
              const states: string[] = [];
              if (metaPart.includes("focused")) states.push("●");
              if (metaPart.includes("selected")) states.push("✓");
              if (metaPart.includes("disabled")) states.push("○");

              if (states.length > 0) {
                parts.push(
                  <span key={key++} className="ml-1 text-[9px]">
                    {metaPart.includes("focused") && (
                      <span className="text-green-500 mr-0.5" title="focused">
                        ●
                      </span>
                    )}
                    {metaPart.includes("selected") && (
                      <span className="text-blue-500 mr-0.5" title="selected">
                        ✓
                      </span>
                    )}
                    {metaPart.includes("disabled") && (
                      <span className="text-slate-400" title="disabled">
                        ○
                      </span>
                    )}
                  </span>
                );
              }
            }
          } else {
            parts.push(
              <span key={key++} className="text-slate-700">
                {remaining}
              </span>
            );
          }
        }

        return (
          <div key={i} className="whitespace-pre">
            {parts}
          </div>
        );
      });
    }, [content]);

    return (
      <div className="relative group">
        {showCopyButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0 z-10 bg-white/90 hover:bg-slate-100 border border-slate-200"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
        <div
          className="bg-slate-50 rounded-md border border-slate-200 p-2 overflow-auto font-mono"
          style={{ fontSize: "0.6rem", lineHeight: "1.5", maxHeight }}
        >
          {highlightedLines}
        </div>
      </div>
    );
  }
);

UiTreeHighlighter.displayName = "UiTreeHighlighter";

/**
 * Lightweight JSON/code syntax highlighter for tool call results.
 * Uses react-syntax-highlighter with Prism for consistent highlighting.
 * Special handling for 'uitree' language with custom highlighting.
 */
export const JsonHighlighter: React.FC<JsonHighlighterProps> = memo(
  ({ content, language = "json", theme = "light", maxHeight = "15rem", showCopyButton = true, className }) => {
    const [copied, setCopied] = useState(false);

    const copyToClipboard = async () => {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    };

    // Use custom UI tree highlighter for uitree language
    if (language === "uitree") {
      return (
        <div className={className}>
          <UiTreeHighlighter content={content} maxHeight={maxHeight} showCopyButton={showCopyButton} />
        </div>
      );
    }

    return (
      <div className={cn("relative group", className)}>
        {showCopyButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0 z-10 bg-gray-200/80 hover:bg-gray-300/80"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
        <SyntaxHighlighter
          language={language}
          style={theme === "dark" ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            borderRadius: "0.25rem",
            fontSize: "0.625rem",
            lineHeight: "1.3",
            padding: "0.5rem",
            maxHeight,
            overflowY: "auto",
            overflowX: "auto",
            whiteSpace: "pre",
            border: "1px solid #e5e7eb",
          }}
          showLineNumbers={false}
          wrapLines={false}
          wrapLongLines={false}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    );
  }
);

JsonHighlighter.displayName = "JsonHighlighter";
