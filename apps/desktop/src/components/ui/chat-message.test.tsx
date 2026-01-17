import { describe, it, expect } from "vitest";

describe("run_command code formatting", () => {
  // Simulate the data we receive - this is what the UI gets
  const mockToolCall = {
    toolName: "run_command",
    args: {
      engine: "node",
      run: '\\ntry {\\n    const tokenName = \\"mediar-\\" + Date.now();\\n    console.log(`Creating Vercel token`);\\n} catch (e) {\\n    console.error(e);\\n}',
    },
  };

  // Alternative format that might come from different source
  const mockToolCallAlt = {
    name: "run_command",
    arguments: {
      engine: "node",
      run: "\\ntry {\\n    const x = 1;\\n}",
    },
  };

  it("should unescape \\\\n to actual newlines", () => {
    const run = mockToolCall.args.run;
    const formatted = run.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');

    expect(formatted).toContain("\n");
    expect(formatted.split("\n").length).toBeGreaterThan(1);
    console.log("Formatted output:");
    console.log(formatted);
  });

  it("should unescape escaped quotes", () => {
    const run = mockToolCall.args.run;
    const formatted = run.replace(/\\"/g, '"');

    expect(formatted).toContain('"mediar-"');
    expect(formatted).not.toContain('\\"mediar-\\"');
  });

  it("should handle the full transformation", () => {
    const run = mockToolCall.args.run;
    const formatted = run.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');

    // Should have multiple lines
    const lines = formatted.split("\n");
    expect(lines.length).toBeGreaterThan(3);

    // Should have proper quotes
    expect(formatted).toContain('"mediar-"');

    // Print for visual verification
    console.log("=== Formatted Code ===");
    console.log(formatted);
    console.log("=== End ===");
  });

  it("should normalize toolName from name", () => {
    const tc = mockToolCallAlt;
    const toolName = (tc as any).toolName || (tc as any).name;
    expect(toolName).toBe("run_command");
  });

  it("should normalize args from arguments", () => {
    const tc = mockToolCallAlt;
    const toolArgs = (tc as any).args || (tc as any).arguments || {};
    expect(toolArgs.engine).toBe("node");
    expect(toolArgs.run).toBeDefined();
  });

  it("condition check - toolName === run_command && toolArgs.run", () => {
    const tc = mockToolCall;
    const toolName = (tc as any).toolName || (tc as any).name;
    const toolArgs = (tc as any).args || (tc as any).arguments || {};

    const condition = toolName === "run_command" && !!toolArgs?.run;
    expect(condition).toBe(true);
  });
});
