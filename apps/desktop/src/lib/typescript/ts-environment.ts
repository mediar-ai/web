/**
 * TypeScript Virtual Environment
 *
 * Creates and manages a TypeScript language service environment in the browser
 * using @typescript/vfs for powering in-editor type checking.
 */

import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
  VirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import ts from "typescript";
import { invoke } from "@tauri-apps/api/core";

/** Compiler options for the TypeScript environment */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  esModuleInterop: true,
  skipLibCheck: true,
  allowSyntheticDefaultImports: true,
  jsx: ts.JsxEmit.React,
  lib: ["ES2020", "DOM", "DOM.Iterable"],
};

/** Result from reading type definitions via Tauri */
interface TypeDefinitionsResult {
  definitions: Record<string, string>;
  loaded: string[];
  failed: Array<{ package: string; error: string }>;
}

/** Diagnostic from TypeScript compiler */
export interface TsDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
  code?: number;
}

/** Completion item from TypeScript */
export interface TsCompletion {
  label: string;
  kind: string;
  detail?: string;
  insertText?: string;
}

/** Display part from TypeScript with syntax info */
export interface TsDisplayPart {
  text: string;
  kind: string;
}

/** Hover info from TypeScript */
export interface TsHoverInfo {
  text: string;
  displayParts: TsDisplayPart[];
  documentation?: string;
}

/**
 * TypeScript Environment Manager
 *
 * Manages a virtual TypeScript environment with loaded type definitions.
 * Thread-safe singleton pattern for web worker usage.
 */
export class TypeScriptEnvironment {
  private env: VirtualTypeScriptEnvironment | null = null;
  private fsMap: Map<string, string> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Add minimal lib stubs when CDN loading fails
   * This provides essential global types like Promise, Array, etc.
   */
  private addMinimalLibStubs(): void {
    // Essential ES2020 globals - minimal definitions to prevent "Cannot find global type" errors
    const libEs2020 = `
// Minimal ES2020 lib stubs
interface Array<T> {
  length: number;
  [n: number]: T;
  push(...items: T[]): number;
  pop(): T | undefined;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: T[]) => boolean): T[];
  find(predicate: (value: T, index: number, obj: T[]) => boolean): T | undefined;
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  includes(searchElement: T): boolean;
  indexOf(searchElement: T): number;
  join(separator?: string): string;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  some(predicate: (value: T, index: number, array: T[]) => boolean): boolean;
  every(predicate: (value: T, index: number, array: T[]) => boolean): boolean;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
}
interface ArrayConstructor {
  new <T>(...items: T[]): T[];
  isArray(arg: any): arg is any[];
  from<T>(arrayLike: ArrayLike<T>): T[];
}
declare var Array: ArrayConstructor;

interface String {
  length: number;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  concat(...strings: string[]): string;
  indexOf(searchString: string, position?: number): number;
  lastIndexOf(searchString: string, position?: number): number;
  slice(start?: number, end?: number): string;
  split(separator: string | RegExp, limit?: number): string[];
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  includes(searchString: string, position?: number): boolean;
  startsWith(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  match(regexp: string | RegExp): RegExpMatchArray | null;
}

interface Number {
  toString(radix?: number): string;
  toFixed(fractionDigits?: number): string;
}

interface Boolean {}

interface Object {
  constructor: Function;
  toString(): string;
  valueOf(): Object;
  hasOwnProperty(v: PropertyKey): boolean;
}
interface ObjectConstructor {
  new(value?: any): Object;
  keys(o: object): string[];
  values<T>(o: { [s: string]: T }): T[];
  entries<T>(o: { [s: string]: T }): [string, T][];
  assign<T, U>(target: T, source: U): T & U;
  fromEntries<T>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T };
}
declare var Object: ObjectConstructor;

interface Function {
  apply(this: Function, thisArg: any, argArray?: any): any;
  call(this: Function, thisArg: any, ...argArray: any[]): any;
  bind(this: Function, thisArg: any, ...argArray: any[]): any;
}

interface RegExp {
  exec(string: string): RegExpExecArray | null;
  test(string: string): boolean;
}
interface RegExpMatchArray extends Array<string> {
  index?: number;
  input?: string;
}
interface RegExpExecArray extends Array<string> {
  index: number;
  input: string;
}

interface Error {
  name: string;
  message: string;
  stack?: string;
}
interface ErrorConstructor {
  new(message?: string): Error;
}
declare var Error: ErrorConstructor;

interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2>;
}

interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}

interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  reject<T = never>(reason?: any): Promise<T>;
  all<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T[]>;
  race<T>(values: readonly (T | PromiseLike<T>)[]): Promise<T>;
}
declare var Promise: PromiseConstructor;

interface JSON {
  parse(text: string, reviver?: (key: any, value: any) => any): any;
  stringify(value: any, replacer?: (key: string, value: any) => any, space?: string | number): string;
}
declare var JSON: JSON;

interface Console {
  log(...data: any[]): void;
  error(...data: any[]): void;
  warn(...data: any[]): void;
  info(...data: any[]): void;
  debug(...data: any[]): void;
}
declare var console: Console;

interface Map<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void;
  readonly size: number;
}
interface MapConstructor {
  new <K, V>(): Map<K, V>;
}
declare var Map: MapConstructor;

interface Set<T> {
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void): void;
  readonly size: number;
}
interface SetConstructor {
  new <T>(): Set<T>;
}
declare var Set: SetConstructor;

interface ArrayLike<T> {
  readonly length: number;
  readonly [n: number]: T;
}

interface Iterable<T> {
  [Symbol.iterator](): Iterator<T>;
}

interface Iterator<T> {
  next(): IteratorResult<T>;
}

interface IteratorResult<T> {
  done: boolean;
  value: T;
}

interface Symbol {}
interface SymbolConstructor {
  readonly iterator: symbol;
}
declare var Symbol: SymbolConstructor;

type PropertyKey = string | number | symbol;
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T extends null | undefined ? never : T;
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F): any } ? F extends ((value: infer V) => any) ? Awaited<V> : never : T;
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never;
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any;
type ThisParameterType<T> = T extends (this: infer U, ...args: any[]) => any ? U : unknown;
type OmitThisParameter<T> = unknown extends ThisParameterType<T> ? T : T extends (...args: infer A) => infer R ? (...args: A) => R : T;
type Uppercase<S extends string> = intrinsic;
type Lowercase<S extends string> = intrinsic;
type Capitalize<S extends string> = intrinsic;
type Uncapitalize<S extends string> = intrinsic;

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...arguments: any[]): number;
declare function clearTimeout(handle?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...arguments: any[]): number;
declare function clearInterval(handle?: number): void;
`;

    this.fsMap.set("/lib.es2020.d.ts", libEs2020);
    console.log("[TS] Added minimal ES2020 lib stubs");
  }

  /**
   * Initialize the TypeScript environment
   *
   * @param workflowId - Optional workflow ID to load package types from
   */
  async initialize(workflowId?: string): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize(workflowId);
    await this.initPromise;
  }

  private async _doInitialize(workflowId?: string): Promise<void> {
    console.log("[TS] Initializing TypeScript environment...");
    console.log("[TS] TypeScript version:", ts.version);

    // Load TypeScript lib files from CDN
    // Suppress 404 errors from CDN - the library probes non-existent paths
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      const msg = String(args[0] ?? "");
      if (msg.includes("playgroundcdn") || msg.includes("Failed to load")) return;
      originalError.apply(console, args);
    };
    try {
      const libFiles = await createDefaultMapFromCDN(
        COMPILER_OPTIONS,
        ts.version,
        true, // Use cache (localStorage available in renderer)
        ts
      );

      console.error = originalError;
      console.log("[TS] Loaded lib files from CDN:", libFiles.size, "files");

      // Merge lib files into fsMap
      for (const [path, content] of libFiles) {
        this.fsMap.set(path, content);
      }
    } catch (err) {
      console.error = originalError;
      console.warn("[TS] Failed to load lib files from CDN, using stubs:", err);
      // Add minimal lib stubs to prevent "Cannot find global type" errors
      this.addMinimalLibStubs();
    }

    // If no lib files loaded, add minimal stubs
    if (this.fsMap.size === 0) {
      console.warn("[TS] No lib files loaded, adding minimal stubs");
      this.addMinimalLibStubs();
    }

    // Load workflow-specific type definitions if provided
    if (workflowId) {
      try {
        await this.loadWorkflowTypes(workflowId);
      } catch (err) {
        console.error("[TS] Failed to load workflow types:", err);
        // Continue without workflow types - better than crashing
      }
    }

    console.log("[TS] Creating virtual TypeScript environment with", this.fsMap.size, "files");

    // Create the virtual file system and environment
    const system = createSystem(this.fsMap);
    this.env = createVirtualTypeScriptEnvironment(system, [], ts, COMPILER_OPTIONS);

    // Register all files with the language service
    // This is needed because createVirtualTypeScriptEnvironment doesn't auto-register fsMap files
    let registeredCount = 0;
    for (const [path, content] of this.fsMap) {
      try {
        this.env.createFile(path, content);
        registeredCount++;
      } catch {
        // File might already be registered via the system, that's OK
      }
    }
    console.log("[TS] Registered", registeredCount, "files with language service");

    this.isInitialized = true;
    console.log("[TS] TypeScript environment initialized successfully");
  }

  /**
   * Add a file to both fsMap and the live environment (if initialized)
   * Uses try-catch because env methods can throw for various reasons
   */
  private addFile(path: string, content: string): void {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    // Always update our local map
    this.fsMap.set(normalizedPath, content);

    // If environment exists, add/update the file there too
    if (this.env) {
      try {
        // Try createFile first (works for new files)
        this.env.createFile(normalizedPath, content);
      } catch {
        // File might already exist, try updateFile
        try {
          this.env.updateFile(normalizedPath, content);
        } catch {
          // Both failed - file is still in fsMap for diagnostics
        }
      }
    }
  }

  /**
   * Load type definitions from a workflow's node_modules and workflow source files
   */
  async loadWorkflowTypes(workflowId: string): Promise<string[]> {
    console.log("[TS] Loading workflow types for:", workflowId);

    // First, load workflow source files so relative imports work
    try {
      const sourceFiles = await invoke<Record<string, string>>("read_workflow_source_files", {
        workflowId,
      });

      console.log("[TS] Loaded workflow source files:", Object.keys(sourceFiles).length);

      for (const [path, content] of Object.entries(sourceFiles)) {
        // Skip if file already in fsMap with same content
        if (this.fsMap.get(path) === content) {
          continue;
        }
        this.addFile(path, content);
      }
    } catch (err) {
      console.warn("[TS] Failed to load workflow source files:", err);
      // Continue - source files are optional for type checking
    }

    try {
      // Get list of packages to load types for
      const packages = await invoke<string[]>("get_workflow_type_packages", {
        workflowId,
      });

      console.log("[TS] Packages to load:", packages);

      if (packages.length === 0) {
        console.log("[TS] No packages to load");
        return [];
      }

      // Read type definitions from Tauri
      const result = await invoke<TypeDefinitionsResult>("read_type_definitions", {
        workflowId,
        packages,
      });

      console.log("[TS] Type definitions result:", {
        loaded: result.loaded,
        failed: result.failed,
        definitionsCount: Object.keys(result.definitions).length,
      });

      // Log first few definition paths for debugging
      const defPaths = Object.keys(result.definitions).slice(0, 10);
      console.log("[TS] Sample definition paths:", defPaths);

      // Add definitions to virtual file system (and live environment if initialized)
      let addedCount = 0;
      for (const [path, content] of Object.entries(result.definitions)) {
        try {
          this.addFile(path, content);
          addedCount++;
        } catch (err) {
          console.error("[TS] Error adding definition file:", path, err);
        }
      }
      console.log("[TS] Successfully added", addedCount, "definition files");

      // Log any failures
      if (result.failed.length > 0) {
        console.warn("[TS] Failed to load types for:", result.failed.map(f => `${f.package}: ${f.error}`).join(", "));
      }

      return result.loaded;
    } catch (error) {
      console.error("[TS] Failed to load workflow types:", error);
      return [];
    }
  }

  /**
   * Add or update a file in the virtual file system
   */
  updateFile(fileName: string, content: string): void {
    if (!this.env) {
      console.warn("[TS] updateFile called but env not initialized");
      return;
    }

    const normalizedPath = fileName.startsWith("/") ? fileName : `/${fileName}`;

    try {
      if (this.fsMap.has(normalizedPath)) {
        this.env.updateFile(normalizedPath, content);
      } else {
        this.fsMap.set(normalizedPath, content);
        this.env.createFile(normalizedPath, content);
      }
    } catch (err) {
      console.error("[TS] Error updating file", normalizedPath, err);
    }
  }

  /**
   * Get diagnostics (type errors) for a file
   */
  getDiagnostics(fileName: string): TsDiagnostic[] {
    if (!this.env) {
      return [];
    }

    const normalizedPath = fileName.startsWith("/") ? fileName : `/${fileName}`;

    try {
      const syntactic = this.env.languageService.getSyntacticDiagnostics(normalizedPath);
      const semantic = this.env.languageService.getSemanticDiagnostics(normalizedPath);

      return [...syntactic, ...semantic].map(d => ({
        from: d.start ?? 0,
        to: (d.start ?? 0) + (d.length ?? 0),
        severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        code: d.code,
      }));
    } catch (err) {
      console.error("[TS] Error getting diagnostics for", normalizedPath, err);
      return [];
    }
  }

  /**
   * Get completions at a position
   */
  getCompletions(fileName: string, position: number): TsCompletion[] {
    if (!this.env) {
      return [];
    }

    const normalizedPath = fileName.startsWith("/") ? fileName : `/${fileName}`;

    const completions = this.env.languageService.getCompletionsAtPosition(normalizedPath, position, {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true,
    });

    if (!completions) {
      return [];
    }

    return completions.entries.map(entry => ({
      label: entry.name,
      kind: ts.ScriptElementKind[entry.kind] ?? "unknown",
      detail: entry.labelDetails?.detail,
      insertText: entry.insertText ?? entry.name,
    }));
  }

  /**
   * Get hover information at a position
   */
  getHoverInfo(fileName: string, position: number): TsHoverInfo | null {
    if (!this.env) {
      return null;
    }

    const normalizedPath = fileName.startsWith("/") ? fileName : `/${fileName}`;

    const info = this.env.languageService.getQuickInfoAtPosition(normalizedPath, position);

    if (!info) {
      return null;
    }

    const text = ts.displayPartsToString(info.displayParts);
    const documentation = ts.displayPartsToString(info.documentation);
    const displayParts = (info.displayParts ?? []).map(part => ({
      text: part.text,
      kind: part.kind,
    }));

    return {
      text,
      displayParts,
      documentation: documentation || undefined,
    };
  }

  /**
   * Get definition location for a symbol
   */
  getDefinition(fileName: string, position: number): { fileName: string; start: number; end: number } | null {
    if (!this.env) {
      return null;
    }

    const normalizedPath = fileName.startsWith("/") ? fileName : `/${fileName}`;

    const definitions = this.env.languageService.getDefinitionAtPosition(normalizedPath, position);

    if (!definitions || definitions.length === 0) {
      return null;
    }

    const def = definitions[0];
    return {
      fileName: def.fileName,
      start: def.textSpan.start,
      end: def.textSpan.start + def.textSpan.length,
    };
  }

  /**
   * Check if the environment is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Dispose the environment
   */
  dispose(): void {
    this.env = null;
    this.fsMap.clear();
    this.isInitialized = false;
    this.initPromise = null;
  }
}

/** Singleton instance for use in the main thread */
let instance: TypeScriptEnvironment | null = null;

/**
 * Get or create the TypeScript environment singleton
 */
export function getTypeScriptEnvironment(): TypeScriptEnvironment {
  if (!instance) {
    instance = new TypeScriptEnvironment();
  }
  return instance;
}

/**
 * Dispose the TypeScript environment singleton
 */
export function disposeTypeScriptEnvironment(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
