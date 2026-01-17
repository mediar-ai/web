import { describe, it, expect } from "vitest";
import { lintCode } from "../rules";
import "../dangerous-keys"; // Register the rule

describe("dangerous-keys linter", () => {
  it("detects Alt+F4 in pressKey call", () => {
    const code = `
      await desktop.pressKey('{Alt}{F4}');
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message).toContain("Alt+F4");
    expect(results[0].severity).toBe("error");
  });

  it("detects Ctrl+W in pressKey call", () => {
    const code = `
      await desktop.pressKey('{Ctrl}w');
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message).toContain("Ctrl+W");
  });

  it("detects Ctrl+Q in pressKeyGlobal call", () => {
    const code = `
      await desktop.pressKeyGlobal('{Ctrl}q');
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message).toContain("Ctrl+Q");
  });

  it("detects press_key_global MCP tool call", () => {
    const code = `
      const result = await callTool('press_key_global', { key: '{Alt}{F4}' });
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message).toContain("Alt+F4");
  });

  it("detects Cmd+W for macOS", () => {
    const code = `
      await desktop.pressKey('{Cmd}w');
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message).toContain("Cmd+W");
  });

  it("does not flag safe keys", () => {
    const code = `
      await desktop.pressKey('{Ctrl}c');
      await desktop.pressKey('{Ctrl}v');
      await desktop.pressKey('{Enter}');
    `;
    const results = lintCode(code);
    expect(results.length).toBe(0);
  });

  it("ignores commented out dangerous keys", () => {
    const code = `
      // await desktop.pressKey('{Alt}{F4}');
    `;
    const results = lintCode(code);
    // Should not report errors/warnings for commented code (may still report hints)
    const seriousIssues = results.filter(r => r.severity === "error" || r.severity === "warning");
    expect(seriousIssues.length).toBe(0);
  });

  it("provides fix suggestions including AI help", () => {
    const code = `
      await desktop.pressKey('{Alt}{F4}');
    `;
    const results = lintCode(code);
    expect(results[0].actions).toBeDefined();
    expect(results[0].actions?.length).toBe(2);

    // First action: Comment out
    const commentAction = results[0].actions?.[0];
    expect(commentAction?.label).toBe("Comment out");
    expect(commentAction?.type).toBe("replace");
    expect(commentAction?.replacement).toContain("DANGEROUS");
    expect(commentAction?.replacement).toMatch(/^\s*\/\//);

    // Second action: Ask AI to fix
    const aiAction = results[0].actions?.[1];
    expect(aiAction?.label).toBe("Ask AI to fix");
    expect(aiAction?.type).toBe("ask-ai");
    expect(aiAction?.prompt).toContain("Dangerous Hotkey Detected");
    expect(aiAction?.prompt).toContain("Alt+F4");
    expect(aiAction?.prompt).toContain("safer alternative");
  });

  it("detects Ctrl+Alt+Delete", () => {
    const code = `
      await desktop.pressKey('{Ctrl}{Alt}{Delete}');
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message).toContain("Ctrl+Alt+Delete");
    expect(results[0].severity).toBe("error");
  });

  it("detects key in JSON-style arguments", () => {
    const code = `
      { "key": "{Alt}{F4}", "timeout_ms": 5000 }
    `;
    const results = lintCode(code);
    expect(results.length).toBeGreaterThan(0);
  });
});
