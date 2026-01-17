/**
 * TypeScript In-Editor Type Checking
 *
 * This module provides VSCode-level TypeScript type checking in CodeMirror editors.
 *
 * Architecture:
 * - Uses @typescript/vfs for virtual file system
 * - Loads type definitions from workflow's node_modules via Tauri
 * - Provides CodeMirror extensions for linting, autocomplete, hover, goto
 *
 * Usage:
 * ```typescript
 * import { createTsExtensions, getTypeScriptEnvironment } from '@/lib/typescript';
 *
 * // In your editor component:
 * const extensions = await createTsExtensions({
 *   fileName: '/src/terminator.ts',
 *   workflowId: 'abc-123',
 * });
 * ```
 */

export {
  TypeScriptEnvironment,
  getTypeScriptEnvironment,
  disposeTypeScriptEnvironment,
  type TsDiagnostic,
  type TsCompletion,
  type TsHoverInfo,
  type TsDisplayPart,
} from "./ts-environment";

export {
  createTsExtensions,
  createTsLinter,
  createTsAutocomplete,
  createTsHover,
  syncToTypeScript,
  tsConfigFacet,
  type TsEditorConfig,
} from "./codemirror-extensions";
