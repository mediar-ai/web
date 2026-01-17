import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import React, { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  theme?: "light" | "dark";
  // Compact mode significantly reduces paddings/margins/line-heights for dense blocks (e.g., tool results)
  compact?: boolean;
  // Inherit text color from parent instead of using hardcoded gray colors
  inheritColor?: boolean;
}

interface CodeBlockProps {
  children: string;
  className?: string;
  theme?: "light" | "dark";
  compact?: boolean;
}

// Enhanced language detection and mapping
const getLanguage = (className?: string): string => {
  if (!className) return "";

  const match = className.match(/language-(\w+)/);
  if (!match) return "";

  const lang = match[1].toLowerCase();

  // Language aliases mapping for better compatibility
  const languageMap: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    ps1: "powershell",
    psm1: "powershell",
    cmd: "batch",
    bat: "batch",
    yml: "yaml",
    rs: "rust",
    go: "go",
    php: "php",
    cpp: "cpp",
    "c++": "cpp",
    cxx: "cpp",
    cc: "cpp",
    cs: "csharp",
    fs: "fsharp",
    vb: "vbnet",
    kt: "kotlin",
    swift: "swift",
    r: "r",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    docker: "dockerfile",
    dockerfile: "dockerfile",
    md: "markdown",
    tex: "latex",
    vue: "vue",
    svelte: "svelte",
    scss: "scss",
    sass: "sass",
    less: "less",
    stylus: "stylus",
    toml: "toml",
    ini: "ini",
    cfg: "ini",
    conf: "nginx",
    nginx: "nginx",
    apache: "apache",
    htaccess: "apache",
    xml: "xml",
    svg: "xml",
    xhtml: "xml",
    rss: "xml",
    atom: "xml",
    plist: "xml",
    xaml: "xml",
    elm: "elm",
    clj: "clojure",
    cljs: "clojure",
    edn: "clojure",
    hs: "haskell",
    lhs: "haskell",
    ml: "ocaml",
    mli: "ocaml",
    scala: "scala",
    sc: "scala",
    dart: "dart",
    lua: "lua",
    pl: "perl",
    pm: "perl",
    zig: "zig",
    nim: "nim",
    crystal: "crystal",
    cr: "crystal",
    julia: "julia",
    jl: "julia",
    matlab: "matlab",
    m: "matlab",
    makefile: "makefile",
    make: "makefile",
    cmake: "cmake",
    gradle: "gradle",
    groovy: "groovy",
    protobuf: "protobuf",
    proto: "protobuf",
    thrift: "thrift",
    avro: "json",
    solidity: "solidity",
    sol: "solidity",
    terraform: "hcl",
    tf: "hcl",
    hcl: "hcl",
    prisma: "prisma",
    diff: "diff",
    patch: "diff",
    log: "log",
    ansi: "bash",
    zsh: "bash",
    fish: "bash",
    mermaid: "mermaid",
    plantuml: "plantuml",
    puml: "plantuml",
    asm: "nasm",
    assembly: "nasm",
    s: "nasm",
    wasm: "wasm",
    wat: "wasm",
    glsl: "glsl",
    hlsl: "hlsl",
    shader: "glsl",
    apex: "apex",
    cls: "apex",
    trigger: "apex",
    flow: "json",
    workflow: "yaml",
    action: "yaml",
    pipeline: "yaml",
    bicep: "bicep",
    arm: "json",
    cloudformation: "yaml",
    cfn: "yaml",
    k8s: "yaml",
    kubernetes: "yaml",
    helm: "yaml",
    nomad: "hcl",
    consul: "hcl",
    vault: "hcl",
    packer: "json",
    vagrant: "ruby",
    ansible: "yaml",
    saltstack: "yaml",
    puppet: "puppet",
    chef: "ruby",
    powershell: "powershell",
    pwsh: "powershell",
  };

  return languageMap[lang] || lang;
};

const CodeBlock: React.FC<CodeBlockProps> = memo(({ children, className, theme = "dark", compact = false }) => {
  const [copied, setCopied] = useState(false);
  const detectedLanguage = getLanguage(className);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  // If no language detected, render as inline code
  if (!detectedLanguage) {
    return (
      <code className="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
        {children}
      </code>
    );
  }

  // Display name for the language header
  const getDisplayLanguage = (lang: string): string => {
    const displayNames: Record<string, string> = {
      javascript: "JavaScript",
      typescript: "TypeScript",
      python: "Python",
      java: "Java",
      csharp: "C#",
      cpp: "C++",
      c: "C",
      rust: "Rust",
      go: "Go",
      ruby: "Ruby",
      php: "PHP",
      swift: "Swift",
      kotlin: "Kotlin",
      scala: "Scala",
      dart: "Dart",
      r: "R",
      matlab: "MATLAB",
      sql: "SQL",
      graphql: "GraphQL",
      html: "HTML",
      css: "CSS",
      scss: "SCSS",
      sass: "Sass",
      less: "Less",
      json: "JSON",
      xml: "XML",
      yaml: "YAML",
      toml: "TOML",
      ini: "INI",
      bash: "Bash",
      powershell: "PowerShell",
      batch: "Batch",
      dockerfile: "Docker",
      nginx: "Nginx",
      apache: "Apache",
      markdown: "Markdown",
      latex: "LaTeX",
      vue: "Vue",
      svelte: "Svelte",
      elm: "Elm",
      clojure: "Clojure",
      haskell: "Haskell",
      ocaml: "OCaml",
      lua: "Lua",
      perl: "Perl",
      solidity: "Solidity",
      hcl: "HCL",
      terraform: "Terraform",
      prisma: "Prisma",
      diff: "Diff",
      log: "Log",
      mermaid: "Mermaid",
      plantuml: "PlantUML",
      nasm: "Assembly",
      wasm: "WebAssembly",
      glsl: "GLSL",
      hlsl: "HLSL",
      apex: "Apex",
    };

    return displayNames[lang] || lang.toUpperCase();
  };

  return (
    <div className={cn("relative group max-w-full min-w-0 overflow-x-hidden", compact ? "my-1" : "my-4")}>
      <div
        className={cn(
          "flex items-center justify-between bg-gray-800 dark:bg-gray-900 rounded-t-lg",
          compact ? "px-2 py-1" : "px-4 py-2"
        )}
      >
        <span className="text-xs text-gray-400 font-mono font-medium">{getDisplayLanguage(detectedLanguage)}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className={cn(
            "opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-200 p-0",
            compact ? "h-6 w-6" : "h-8 w-8"
          )}
          title="Copy code"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      <SyntaxHighlighter
        language={detectedLanguage}
        style={theme === "dark" ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: "0.5rem",
          borderBottomRightRadius: "0.5rem",
          fontSize: compact ? "0.65rem" : "0.75rem",
          lineHeight: compact ? "1.2" : "1.5",
          padding: compact ? "0.5rem" : "1rem",
          // Constrain width and keep horizontal scroll instead of hard-wrapping tokens
          maxWidth: "100%",
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          display: "block",
          whiteSpace: "pre",
          overflowX: "auto",
        }}
        showLineNumbers={true}
        lineNumberStyle={{
          minWidth: compact ? "2rem" : "3rem",
          paddingRight: compact ? "0.5rem" : "1rem",
          color: theme === "dark" ? "#6B7280" : "#9CA3AF",
          fontSize: "0.8rem",
          userSelect: "none",
        }}
        wrapLines={false}
        wrapLongLines={false}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
});

CodeBlock.displayName = "CodeBlock";

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  theme = "auto",
  className = "",
  compact = false,
  inheritColor = false,
}) => {
  if (!content || content === "undefined" || content.trim() === "") {
    return <div className="text-gray-500 italic text-xs">[No content to display]</div>;
  }

  try {
    return (
      <div className={cn("max-w-full overflow-x-hidden", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            code({ node, className, children, ...props }: any) {
              const inline = !className;
              const match = /language-(\w+)/.exec(className || "");

              if (!inline && match) {
                return (
                  <CodeBlock className={className} theme={theme} compact={compact} {...props}>
                    {String(children).replace(/\n$/, "")}
                  </CodeBlock>
                );
              }

              return (
                <code
                  className={cn(
                    "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded text-xs font-mono break-all",
                    compact ? "px-1 py-0" : "px-1.5 py-0.5"
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre({ children }) {
              return <>{children}</>;
            },
            blockquote({ children }) {
              return (
                <blockquote
                  className={cn(
                    "border-l-4 border-gray-300 dark:border-gray-600 italic text-gray-700 dark:text-gray-300",
                    compact ? "pl-3 my-2" : "pl-4 my-4"
                  )}
                >
                  {children}
                </blockquote>
              );
            },
            table({ children }) {
              return (
                <div className={cn("overflow-x-auto", compact ? "my-2" : "my-4")}>
                  <table className="min-w-full border border-gray-200 dark:border-gray-700 rounded-lg">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th
                  className={cn(
                    "border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-left font-semibold",
                    compact ? "px-2 py-1" : "px-4 py-2"
                  )}
                >
                  {children}
                </th>
              );
            },
            td({ children }) {
              return (
                <td
                  className={cn("border-b border-gray-200 dark:border-gray-700", compact ? "px-2 py-1" : "px-4 py-2")}
                >
                  {children}
                </td>
              );
            },
            ul({ children }) {
              return (
                <ul
                  className={cn("list-disc list-inside break-words", compact ? "space-y-0.5 my-1" : "space-y-1 my-2")}
                >
                  {children}
                </ul>
              );
            },
            ol({ children }) {
              return (
                <ol
                  className={cn(
                    "list-decimal list-inside break-words",
                    compact ? "space-y-0.5 my-1" : "space-y-1 my-2"
                  )}
                >
                  {children}
                </ol>
              );
            },
            li({ children }) {
              return (
                <li className={inheritColor ? "break-words" : "text-gray-700 dark:text-gray-300 break-words"}>
                  {children}
                </li>
              );
            },
            h1({ children }) {
              return <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-gray-100">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-gray-100">{children}</h3>;
            },
            p({ children }) {
              return (
                <p
                  className={cn(
                    inheritColor ? "break-words" : "text-gray-700 dark:text-gray-300 break-words",
                    compact ? "leading-tight mb-0.5" : "leading-relaxed mb-0"
                  )}
                >
                  {children}
                </p>
              );
            },
            strong({ children }) {
              return (
                <strong className={inheritColor ? "font-bold" : "font-bold text-gray-900 dark:text-gray-100"}>
                  {children}
                </strong>
              );
            },
            em({ children }) {
              return (
                <em className={inheritColor ? "italic" : "italic text-gray-700 dark:text-gray-300"}>{children}</em>
              );
            },
            a({ href, children }) {
              // Check if this is a file path (local file or VS Code URI)
              const isFilePath =
                href &&
                (href.startsWith("file://") ||
                  href.startsWith("vscode://") ||
                  href.startsWith("./") ||
                  href.startsWith("../") ||
                  href.startsWith("/") ||
                  // Windows path patterns
                  /^[A-Za-z]:[\\/]/.test(href) ||
                  // Relative paths without protocol
                  /^[^:/]+\.(ts|tsx|js|jsx|rs|md|yaml|yml|json|toml|txt|py|go|java|cpp|h|c|cs|php|rb|swift|kt|dart|scala|clj|hs|ml|fs|vb|lua|pl|sh|ps1|bat|cmd|cfg|ini|conf|log)$/i.test(
                    href
                  ));

              if (isFilePath) {
                // For file paths, use Tauri shell API with VS Code's reuse-window flag
                return (
                  <a
                    href="#"
                    className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    onClick={async e => {
                      e.preventDefault();
                      try {
                        let filePath = href;

                        // Convert file:// URLs to regular paths
                        if (filePath.startsWith("file://")) {
                          filePath = filePath.replace("file://", "");
                          // Handle Windows file URLs
                          if (filePath.startsWith("/") && /^\/[A-Za-z]:/.test(filePath)) {
                            filePath = filePath.substring(1);
                          }
                        }

                        // Convert relative paths to absolute
                        if (filePath.startsWith("./") || filePath.startsWith("../")) {
                          // For relative paths, we'll let VS Code handle the resolution
                          // by using the workspace root context
                        }

                        // Open with VS Code using --reuse-window to avoid new groups
                        console.log("📂 Opening file in current VS Code group:", filePath);
                        await invoke("plugin:shell|execute", {
                          program: "code",
                          args: ["--reuse-window", filePath],
                        });
                      } catch (error) {
                        console.error("❌ Failed to open file with VS Code:", error);
                        // Fallback: try opening with default system handler
                        try {
                          await invoke("plugin:shell|open", {
                            path: href,
                          });
                        } catch (fallbackError) {
                          console.error("❌ Fallback open also failed:", fallbackError);
                          // Last resort: use browser default (will create new group)
                          window.open(href, "_blank");
                        }
                      }
                    }}
                  >
                    {children}
                  </a>
                );
              }

              // For web URLs, continue using target="_blank"
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  } catch (error) {
    console.error("MarkdownRenderer error:", error);
    // Fallback to plain text if markdown fails
    return (
      <div className={cn("text-xs text-gray-700 dark:text-gray-300 leading-relaxed", className)}>
        <pre className="whitespace-pre-wrap font-sans">{content}</pre>
      </div>
    );
  }
};

MarkdownRenderer.displayName = "MarkdownRenderer";
