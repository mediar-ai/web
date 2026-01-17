import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TypeScriptEnvironment, getTypeScriptEnvironment, disposeTypeScriptEnvironment } from "../ts-environment";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @typescript/vfs CDN loading
vi.mock("@typescript/vfs", () => ({
  createDefaultMapFromCDN: vi.fn().mockResolvedValue(
    new Map([
      ["/lib.es2020.d.ts", "declare const console: { log: (...args: any[]) => void };"],
      ["/lib.dom.d.ts", "declare const document: Document;"],
    ])
  ),
  createSystem: vi.fn().mockReturnValue({
    args: [],
    newLine: "\n",
    useCaseSensitiveFileNames: true,
    write: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    resolvePath: (path: string) => path,
    fileExists: vi.fn().mockReturnValue(true),
    directoryExists: vi.fn().mockReturnValue(true),
    createDirectory: vi.fn(),
    getExecutingFilePath: () => "/",
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    readDirectory: () => [],
    exit: vi.fn(),
  }),
  createVirtualTypeScriptEnvironment: vi.fn().mockReturnValue({
    languageService: {
      getSyntacticDiagnostics: vi.fn().mockReturnValue([]),
      getSemanticDiagnostics: vi.fn().mockReturnValue([
        {
          start: 0,
          length: 5,
          category: 1, // Error
          code: 2304,
          messageText: "Cannot find name 'foo'.",
        },
      ]),
      getCompletionsAtPosition: vi.fn().mockReturnValue({
        entries: [
          { name: "console", kind: "var", insertText: "console" },
          { name: "document", kind: "var", insertText: "document" },
        ],
      }),
      getQuickInfoAtPosition: vi.fn().mockReturnValue({
        displayParts: [{ text: "const foo: string" }],
        documentation: [{ text: "A test variable" }],
      }),
      getDefinitionAtPosition: vi.fn().mockReturnValue([
        {
          fileName: "/main.ts",
          textSpan: { start: 10, length: 3 },
        },
      ]),
    },
    updateFile: vi.fn(),
    createFile: vi.fn(),
  }),
}));

describe("TypeScriptEnvironment", () => {
  let env: TypeScriptEnvironment;

  beforeEach(() => {
    env = new TypeScriptEnvironment();
  });

  afterEach(() => {
    env.dispose();
    disposeTypeScriptEnvironment();
  });

  describe("initialization", () => {
    it("should not be ready before initialize", () => {
      expect(env.isReady()).toBe(false);
    });

    it("should be ready after initialize", async () => {
      await env.initialize();
      expect(env.isReady()).toBe(true);
    });

    it("should only initialize once", async () => {
      // Initialize multiple times
      await env.initialize();
      const readyAfterFirst = env.isReady();

      await env.initialize();
      await env.initialize();

      // Should still be ready (not re-initialized or broken)
      expect(readyAfterFirst).toBe(true);
      expect(env.isReady()).toBe(true);
    });
  });

  describe("getDiagnostics", () => {
    it("should return empty array when not initialized", () => {
      const diagnostics = env.getDiagnostics("/main.ts");
      expect(diagnostics).toEqual([]);
    });

    it("should return diagnostics after initialization", async () => {
      await env.initialize();
      env.updateFile("/main.ts", "const x = foo;");

      const diagnostics = env.getDiagnostics("/main.ts");

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]).toMatchObject({
        severity: "error",
        message: expect.stringContaining("foo"),
      });
    });

    it("should normalize file paths", async () => {
      await env.initialize();

      // Both should work
      env.updateFile("main.ts", "const x = 1;");
      const d1 = env.getDiagnostics("main.ts");
      const d2 = env.getDiagnostics("/main.ts");

      expect(Array.isArray(d1)).toBe(true);
      expect(Array.isArray(d2)).toBe(true);
    });
  });

  describe("getCompletions", () => {
    it("should return empty array when not initialized", () => {
      const completions = env.getCompletions("/main.ts", 0);
      expect(completions).toEqual([]);
    });

    it("should return completions after initialization", async () => {
      await env.initialize();
      env.updateFile("/main.ts", "con");

      const completions = env.getCompletions("/main.ts", 3);

      expect(completions.length).toBeGreaterThan(0);
      expect(completions.some(c => c.label === "console")).toBe(true);
    });
  });

  describe("getHoverInfo", () => {
    it("should return null when not initialized", () => {
      const info = env.getHoverInfo("/main.ts", 0);
      expect(info).toBeNull();
    });

    it("should return hover info after initialization", async () => {
      await env.initialize();
      env.updateFile("/main.ts", 'const foo = "test";');

      const info = env.getHoverInfo("/main.ts", 6);

      expect(info).not.toBeNull();
      expect(info?.text).toContain("foo");
    });
  });

  describe("getDefinition", () => {
    it("should return null when not initialized", () => {
      const def = env.getDefinition("/main.ts", 0);
      expect(def).toBeNull();
    });

    it("should return definition after initialization", async () => {
      await env.initialize();
      env.updateFile("/main.ts", "const foo = 1; console.log(foo);");

      const def = env.getDefinition("/main.ts", 28);

      expect(def).not.toBeNull();
      expect(def?.fileName).toBe("/main.ts");
    });
  });

  describe("dispose", () => {
    it("should reset state", async () => {
      await env.initialize();
      expect(env.isReady()).toBe(true);

      env.dispose();

      expect(env.isReady()).toBe(false);
    });
  });
});

describe("singleton functions", () => {
  afterEach(() => {
    disposeTypeScriptEnvironment();
  });

  it("should return same instance", () => {
    const env1 = getTypeScriptEnvironment();
    const env2 = getTypeScriptEnvironment();
    expect(env1).toBe(env2);
  });

  it("should create new instance after dispose", () => {
    const env1 = getTypeScriptEnvironment();
    disposeTypeScriptEnvironment();
    const env2 = getTypeScriptEnvironment();
    expect(env1).not.toBe(env2);
  });
});
