#!/usr/bin/env bun
/**
 * Auto-generate Tauri commands registry from lib.rs
 *
 * This script parses lib.rs and extracts:
 * - Command names from invoke_handler
 * - Doc comments (///) for each command
 * - Function parameters for each command
 *
 * Usage: bun scripts/generate-tauri-commands.ts
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";

// Recursively find all .rs files in a directory
function findRustFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findRustFiles(fullPath));
    } else if (entry.endsWith(".rs")) {
      files.push(fullPath);
    }
  }
  return files;
}

const SRC_TAURI_PATH = join(__dirname, "../src-tauri/src");
const LIB_RS_PATH = join(SRC_TAURI_PATH, "lib.rs");
const OUTPUT_PATH = join(__dirname, "../src/lib/generated/tauri-commands-registry.ts");

// Commands that should be blocked from AI access (dangerous operations)
const BLOCKED_COMMANDS = new Set([
  "reset_all_user_data_and_exit",
  "delete_saved_workflow",
  "delete_typescript_workflow",
  "delete_file",
]);

// Categories for commands (based on prefix or name patterns)
function categorizeCommand(name: string): string {
  if (name.includes("workflow") || name.includes("step")) return "workflow";
  if (name.includes("recording") || name.includes("record")) return "recording";
  if (name.includes("auth") || name.includes("login") || name.includes("logout")) return "auth";
  if (name.includes("mcp")) return "mcp";
  if (name.includes("file") || name.includes("folder") || name.includes("explorer")) return "file";
  if (name.includes("update")) return "update";
  if (name.includes("schedule") || name.includes("trigger")) return "scheduler";
  if (name.includes("claude") || name.includes("vertex") || name.includes("ai")) return "ai";
  if (name.includes("overlay") || name.includes("bar") || name.includes("window") || name.includes("devtools"))
    return "ui";
  if (name.includes("setting") || name.includes("config")) return "settings";
  if (name.includes("log")) return "logging";
  return "system";
}

interface CommandInfo {
  name: string;
  description: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  category: string;
}

function extractCommandsWithMetadata(libRsContent: string, allRsContents: string[]): CommandInfo[] {
  // Find the invoke_handler block to get list of registered commands
  const handlerMatch = libRsContent.match(
    /\.invoke_handler\s*\(\s*tauri::generate_handler!\s*\[\s*([\s\S]*?)\s*\]\s*\)/
  );

  if (!handlerMatch) {
    console.error("Could not find invoke_handler in lib.rs");
    process.exit(1);
  }

  const handlerContent = handlerMatch[1];

  // Extract command names from invoke_handler
  const registeredCommands = new Set<string>();
  for (const line of handlerContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const cleaned = trimmed.replace(/,\s*$/, "");
    if (!cleaned) continue;
    const parts = cleaned.split("::");
    const commandName = parts[parts.length - 1].trim();
    if (commandName && /^[a-z_][a-z0-9_]*$/i.test(commandName)) {
      registeredCommands.add(commandName);
    }
  }

  console.log(`[generate-tauri-commands] Registered commands in invoke_handler: ${registeredCommands.size}`);

  // Now find each command function with its doc comments and signature
  // Search ALL Rust files, not just lib.rs
  const commands: CommandInfo[] = [];
  const foundCommands = new Set<string>();

  // Pattern to find #[tauri::command] OR #[command] with optional doc comments before and function after
  // Match: (doc comments) + #[tauri::command] or #[command] + optional attributes + fn signature + return type
  // Note: Some files use `use tauri::command;` then just `#[command]`
  // Captures: 1=docComments, 2=funcName, 3=params, 4=returnType (optional)
  const commandPattern =
    /((?:\/\/\/[^\n]*\n)*)(?:#\[(?:tauri::)?command\][\s\S]*?)(?:pub\s+)?(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?\s*\{/gi;

  // Search through all Rust file contents
  for (const rsContent of allRsContents) {
    let match;
    // Reset lastIndex for each file
    commandPattern.lastIndex = 0;
    while ((match = commandPattern.exec(rsContent)) !== null) {
      const docComments = match[1] || "";
      const funcName = match[2];
      const paramsStr = match[3];
      const rawReturnType = match[4]?.trim() || "";

      // Only include if registered in invoke_handler
      if (!registeredCommands.has(funcName)) continue;

      // Skip if already found (avoid duplicates from multiple files)
      if (foundCommands.has(funcName)) continue;
      foundCommands.add(funcName);

      // Extract description from doc comments
      const docLines = docComments
        .split("\n")
        .map(line => line.replace(/^\s*\/\/\/\s?/, "").trim())
        .filter(line => line.length > 0);
      const description = docLines.join(" ").trim();

      // Extract parameters (skip app/state/window params)
      const params: Array<{ name: string; type: string }> = [];
      if (paramsStr.trim()) {
        // Split by comma, but be careful with nested generics
        const paramParts = splitParams(paramsStr);
        for (const param of paramParts) {
          const trimmed = param.trim();
          if (!trimmed) continue;

          // Skip Tauri internal params
          if (
            trimmed.includes("tauri::") ||
            trimmed.includes("State<") ||
            trimmed.includes("Window") ||
            trimmed.includes("AppHandle")
          ) {
            continue;
          }

          // Parse "name: Type" pattern
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx > 0) {
            const paramName = trimmed.slice(0, colonIdx).trim();
            const paramType = trimmed.slice(colonIdx + 1).trim();
            params.push({ name: paramName, type: simplifyType(paramType) });
          }
        }
      }

      // Extract and simplify return type
      const returnType = simplifyReturnType(rawReturnType);

      commands.push({
        name: funcName,
        description,
        params,
        returnType,
        category: categorizeCommand(funcName),
      });
    }
  }

  // Log any registered commands that weren't found in source files
  const missingCommands = [...registeredCommands].filter(cmd => !foundCommands.has(cmd));
  if (missingCommands.length > 0) {
    console.warn(
      `[generate-tauri-commands] Warning: ${missingCommands.length} commands registered but not found in source files:`
    );
    console.warn(`  ${missingCommands.join(", ")}`);
  }

  console.log(`[generate-tauri-commands] Found ${foundCommands.size}/${registeredCommands.size} command definitions`);

  // Sort by category then name
  commands.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name);
  });

  return commands;
}

// Split function parameters, respecting nested generics
function splitParams(paramsStr: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of paramsStr) {
    if (char === "<" || char === "(") depth++;
    else if (char === ">" || char === ")") depth--;

    if (char === "," && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current);
  }

  return result;
}

// Simplify Rust types for TypeScript/AI consumption
function simplifyType(rustType: string): string {
  let t = rustType.trim();

  // Remove common wrappers
  t = t.replace(/^Option<(.+)>$/, "$1?");
  t = t.replace(/^Result<([^,]+),\s*[^>]+>$/, "$1");
  t = t.replace(/^Vec<(.+)>$/, "$1[]");

  // Map Rust types to simpler names
  const typeMap: Record<string, string> = {
    String: "string",
    "&str": "string",
    bool: "boolean",
    i32: "number",
    i64: "number",
    u32: "number",
    u64: "number",
    usize: "number",
    f32: "number",
    f64: "number",
  };

  for (const [rust, ts] of Object.entries(typeMap)) {
    t = t.replace(new RegExp(`\\b${rust}\\b`, "g"), ts);
  }

  return t;
}

// Simplify Rust return types for TypeScript/AI consumption
function simplifyReturnType(rustType: string): string {
  if (!rustType) return "void";

  let t = rustType.trim();

  // Handle Result<T, E> - extract T
  const resultMatch = t.match(/^Result\s*<\s*([^,]+)\s*,\s*[^>]+\s*>$/);
  if (resultMatch) {
    t = resultMatch[1].trim();
  }

  // Handle () as void
  if (t === "()" || t === "") return "void";

  // Handle Option<T> - add ? suffix
  const optionMatch = t.match(/^Option\s*<\s*(.+)\s*>$/);
  if (optionMatch) {
    const inner = simplifyReturnType(optionMatch[1]);
    return inner === "void" ? "void" : `${inner} | null`;
  }

  // Handle Vec<T> - convert to array
  const vecMatch = t.match(/^Vec\s*<\s*(.+)\s*>$/);
  if (vecMatch) {
    const inner = simplifyReturnType(vecMatch[1]);
    return `${inner}[]`;
  }

  // Handle HashMap/BTreeMap
  const mapMatch = t.match(/^(?:HashMap|BTreeMap)\s*<\s*([^,]+)\s*,\s*(.+)\s*>$/);
  if (mapMatch) {
    const keyType = simplifyType(mapMatch[1]);
    const valType = simplifyReturnType(mapMatch[2]);
    return `Record<${keyType}, ${valType}>`;
  }

  // Handle tuples like (String, i32)
  if (t.startsWith("(") && t.endsWith(")")) {
    const inner = t.slice(1, -1);
    const parts = splitParams(inner).map(p => simplifyType(p.trim()));
    if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) return "void";
    return `[${parts.join(", ")}]`;
  }

  // Apply basic type simplification
  return simplifyType(t);
}

function generateTypeScript(commands: CommandInfo[]): string {
  const allowedCommands = commands.filter(cmd => !BLOCKED_COMMANDS.has(cmd.name));
  const blockedCommands = commands.filter(cmd => BLOCKED_COMMANDS.has(cmd.name));

  // Group by category for the array
  const byCategory: Record<string, CommandInfo[]> = {};
  for (const cmd of allowedCommands) {
    if (!byCategory[cmd.category]) byCategory[cmd.category] = [];
    byCategory[cmd.category].push(cmd);
  }

  const categoryEntries = Object.entries(byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, cmds]) => `  // ${cat}\n  ${cmds.map(c => `"${c.name}"`).join(",\n  ")}`)
    .join(",\n\n");

  // Generate command metadata object
  const commandMetadata = allowedCommands
    .map(cmd => {
      const paramsStr =
        cmd.params.length > 0
          ? `[${cmd.params.map(p => `{ name: "${p.name}", type: "${p.type}" }`).join(", ")}]`
          : "[]";
      const desc = cmd.description.replace(/"/g, '\\"').replace(/\n/g, " ");
      const retType = cmd.returnType.replace(/"/g, '\\"');
      return `  "${cmd.name}": { description: "${desc}", params: ${paramsStr}, returnType: "${retType}", category: "${cmd.category}" }`;
    })
    .join(",\n");

  return `/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
 * Generated by: bun scripts/generate-tauri-commands.ts
 * Generated at: ${new Date().toISOString()}
 *
 * This file contains all Tauri commands extracted from lib.rs
 */

/**
 * All registered Tauri commands (${commands.length} total)
 */
export const ALL_TAURI_COMMANDS = [
${categoryEntries}
] as const;

export type TauriCommand = (typeof ALL_TAURI_COMMANDS)[number];

/**
 * Commands that are safe for AI to invoke
 */
export const ALLOWED_COMMANDS = new Set<TauriCommand>(ALL_TAURI_COMMANDS);

/**
 * Commands blocked from AI access (dangerous operations)
 */
export const BLOCKED_COMMANDS = new Set<string>([
  ${blockedCommands.map(c => `"${c.name}"`).join(",\n  ")}
]);

/**
 * Command metadata with descriptions and parameters
 */
export interface CommandParam {
  name: string;
  type: string;
}

export interface CommandMetadata {
  description: string;
  params: CommandParam[];
  returnType: string;
  category: string;
}

export const COMMAND_METADATA: Record<TauriCommand, CommandMetadata> = {
${commandMetadata}
};

/**
 * Commands grouped by category
 */
export const COMMANDS_BY_CATEGORY: Record<string, readonly TauriCommand[]> = {
${Object.entries(byCategory)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([cat, cmds]) => `  ${cat}: [${cmds.map(c => `"${c.name}"`).join(", ")}]`)
  .join(",\n")}
} as const;

/**
 * Get all allowed command names as an array
 */
export function getAllowedCommands(): TauriCommand[] {
  return [...ALLOWED_COMMANDS];
}

/**
 * Check if a command is allowed for AI access
 */
export function isCommandAllowed(command: string): command is TauriCommand {
  return ALLOWED_COMMANDS.has(command as TauriCommand) && !BLOCKED_COMMANDS.has(command);
}

/**
 * Get command metadata (description and params)
 */
export function getCommandMetadata(command: TauriCommand): CommandMetadata {
  return COMMAND_METADATA[command];
}

/**
 * Search commands by keyword (searches name and description)
 */
export function searchCommands(query: string): TauriCommand[] {
  const lowerQuery = query.toLowerCase();
  return getAllowedCommands().filter(cmd => {
    const meta = COMMAND_METADATA[cmd];
    return cmd.toLowerCase().includes(lowerQuery) || meta.description.toLowerCase().includes(lowerQuery);
  });
}

/**
 * Get formatted command documentation for AI prompt
 */
export function getCommandDocsForPrompt(): string {
  const byCategory: Record<string, string[]> = {};

  for (const cmd of getAllowedCommands()) {
    const meta = COMMAND_METADATA[cmd];
    const paramsStr = meta.params.length > 0
      ? \`(\${meta.params.map(p => \`\${p.name}: \${p.type}\`).join(", ")})\`
      : "()";
    const returnStr = meta.returnType && meta.returnType !== "void" ? \` -> \${meta.returnType}\` : "";
    const line = meta.description
      ? \`- \${cmd}\${paramsStr}\${returnStr}: \${meta.description}\`
      : \`- \${cmd}\${paramsStr}\${returnStr}\`;

    if (!byCategory[meta.category]) byCategory[meta.category] = [];
    byCategory[meta.category].push(line);
  }

  return Object.entries(byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, lines]) => \`### \${cat}\\n\${lines.join("\\n")}\`)
    .join("\\n\\n");
}
`;
}

// Main
console.log("[generate-tauri-commands] Reading lib.rs...");
const libRsContent = readFileSync(LIB_RS_PATH, "utf-8");

// Read all .rs files recursively in src-tauri/src (including subdirectories like commands/)
console.log("[generate-tauri-commands] Reading all Rust source files (recursive)...");
const rsFilePaths = findRustFiles(SRC_TAURI_PATH);
const allRsContents: string[] = rsFilePaths.map(fullPath => {
  const content = readFileSync(fullPath, "utf-8");
  const relativePath = fullPath.replace(SRC_TAURI_PATH + "/", "").replace(SRC_TAURI_PATH + "\\", "");
  console.log(`  - ${relativePath} (${content.length} bytes)`);
  return content;
});
console.log(`[generate-tauri-commands] Scanned ${rsFilePaths.length} Rust files`);

console.log("[generate-tauri-commands] Extracting commands with metadata...");
const commands = extractCommandsWithMetadata(libRsContent, allRsContents);
console.log(`[generate-tauri-commands] Found ${commands.length} commands`);

// Count commands with descriptions
const withDocs = commands.filter(c => c.description.length > 0);
console.log(`[generate-tauri-commands] ${withDocs.length} commands have descriptions`);

console.log("[generate-tauri-commands] Generating TypeScript...");
const output = generateTypeScript(commands);

// Ensure output directory exists
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

writeFileSync(OUTPUT_PATH, output);
console.log(`[generate-tauri-commands] Written to ${OUTPUT_PATH}`);

// Print summary
const blocked = commands.filter(c => BLOCKED_COMMANDS.has(c.name));
const allowed = commands.filter(c => !BLOCKED_COMMANDS.has(c.name));
console.log(`\nSummary:`);
console.log(`  Total commands: ${commands.length}`);
console.log(`  Allowed for AI: ${allowed.length}`);
console.log(`  Blocked: ${blocked.length}`);
console.log(`  With descriptions: ${withDocs.length}`);
