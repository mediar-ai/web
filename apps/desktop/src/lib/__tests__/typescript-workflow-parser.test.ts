import { describe, it, expect } from "vitest";
import {
  TypeScriptWorkflowParser,
  ParsedWorkflow,
  ParsedInputField,
  ParsedStep,
  WorkflowErrorInfo,
} from "../typescript-workflow-parser";

describe("TypeScriptWorkflowParser", () => {
  const parser = new TypeScriptWorkflowParser();

  describe("parseWorkflow", () => {
    it("should parse a simple workflow with inline steps", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const inputSchema = z.object({});

const myStep = createStep({
  id: "my_step",
  name: "My Step",
  description: "Does something",
  execute: async ({ desktop, logger }) => {
    logger.info("Hello");
    return { state: {} };
  },
});

export default createWorkflow({
  input: inputSchema,
  steps: [myStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].id).toBe("my_step");
      expect(result.steps[0].name).toBe("My Step");
      expect(result.steps[0].description).toBe("Does something");
    });

    it("should parse workflow with name and version", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

export default createWorkflow({
  name: "Test Workflow",
  version: "1.0.0",
  input: z.object({}),
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.name).toBe("Test Workflow");
      expect(result.version).toBe("1.0.0");
    });

    it("should parse multiple inline steps in order", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const step1 = createStep({
  id: "step_1",
  name: "First Step",
  execute: async () => ({ state: {} }),
});

const step2 = createStep({
  id: "step_2",
  name: "Second Step",
  execute: async () => ({ state: {} }),
});

const step3 = createStep({
  id: "step_3",
  name: "Third Step",
  execute: async () => ({ state: {} }),
});

export default createWorkflow({
  input: z.object({}),
  steps: [step1, step2, step3],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].id).toBe("step_1");
      expect(result.steps[1].id).toBe("step_2");
      expect(result.steps[2].id).toBe("step_3");
    });

    it("should detect onError handler", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

export default createWorkflow({
  input: z.object({}),
  steps: [],
  onError: async ({ error, logger }) => {
    logger.error(error.message);
  },
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.hasOnError).toBe(true);
    });

    it("should detect onSuccess handler", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

export default createWorkflow({
  input: z.object({}),
  steps: [],
  onSuccess: async ({ context }) => {
    return context.state;
  },
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.hasOnSuccess).toBe(true);
    });
  });

  describe("parseInputSchema", () => {
    it("should parse empty z.object({})", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toEqual([]);
    });

    it("should parse z.object({}).optional()", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

export default createWorkflow({
  input: z.object({}).optional(),
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toEqual([]);
    });

    it("should parse string field with describe", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  email: z.string().describe("User email address"),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toHaveLength(1);
      expect(result.inputSchema[0]).toEqual({
        name: "email",
        type: "string",
        required: true,
        description: "User email address",
      });
    });

    it("should parse optional field", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  nickname: z.string().optional().describe("Optional nickname"),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema[0].required).toBe(false);
    });

    it("should parse field with default value", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  count: z.number().default(10).describe("Item count"),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema[0]).toMatchObject({
        name: "count",
        type: "number",
        required: false, // has default, so effectively optional
        defaultValue: 10,
      });
    });

    it("should parse boolean field", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  skipValidation: z.boolean().optional().describe("Skip validation step"),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema[0].type).toBe("boolean");
    });

    it("should parse multiple fields", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  email: z.string().describe("Email"),
  password: z.string().describe("Password"),
  rememberMe: z.boolean().optional().default(false),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toHaveLength(3);
      expect(result.inputSchema.map(f => f.name)).toEqual(["email", "password", "rememberMe"]);
    });
  });

  describe("parseStepDetails", () => {
    it("should extract desktop.locator calls", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const clickButton = createStep({
  id: "click_button",
  name: "Click Button",
  execute: async ({ desktop }) => {
    const button = await desktop.locator("role:Button && name:Submit").first(5000);
    await button.click();
    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [clickButton],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].desktopOperations).toBeDefined();
      expect(result.steps[0].desktopOperations.length).toBeGreaterThan(0);
      expect(result.steps[0].desktopOperations).toContainEqual(
        expect.objectContaining({
          type: "locator",
          selector: "role:Button && name:Submit",
        })
      );
    });

    it("should extract desktop.runCommand calls", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const cleanup = createStep({
  id: "cleanup",
  name: "Cleanup",
  execute: async ({ desktop }) => {
    await desktop.runCommand("taskkill /IM app.exe /F");
    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [cleanup],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].desktopOperations).toContainEqual(
        expect.objectContaining({
          type: "runCommand",
          command: "taskkill /IM app.exe /F",
        })
      );
    });

    it("should extract desktop.openApplication calls", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const openApp = createStep({
  id: "open_app",
  name: "Open App",
  execute: async ({ desktop }) => {
    desktop.openApplication("notepad.exe");
    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [openApp],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].desktopOperations).toContainEqual(
        expect.objectContaining({
          type: "openApplication",
          application: "notepad.exe",
        })
      );
    });

    it("should extract desktop.pressKey calls", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const pressKeys = createStep({
  id: "press_keys",
  name: "Press Keys",
  execute: async ({ desktop }) => {
    await desktop.pressKey("{Alt}{Space}");
    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [pressKeys],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].desktopOperations).toContainEqual(
        expect.objectContaining({
          type: "pressKey",
          keys: "{Alt}{Space}",
        })
      );
    });

    it("should extract state keys from return statement", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const fetchData = createStep({
  id: "fetch_data",
  name: "Fetch Data",
  execute: async ({ logger }) => {
    return {
      state: {
        user_id: "123",
        email: "test@example.com",
        is_verified: true,
      },
    };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [fetchData],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].stateKeys).toContain("user_id");
      expect(result.steps[0].stateKeys).toContain("email");
      expect(result.steps[0].stateKeys).toContain("is_verified");
    });
  });

  describe("parseImportedSteps", () => {
    it("should identify imported step references", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";
import { loginStep } from "./steps/01-login";
import { processStep } from "./steps/02-process";

export default createWorkflow({
  input: z.object({}),
  steps: [loginStep, processStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].id).toBe("loginStep");
      expect(result.steps[0].isImported).toBe(true);
      expect(result.steps[0].importPath).toBe("./steps/01-login");
      expect(result.steps[1].id).toBe("processStep");
      expect(result.steps[1].isImported).toBe(true);
      expect(result.steps[1].importPath).toBe("./steps/02-process");
    });
  });

  describe("edge cases", () => {
    it("should handle workflow with no steps", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

export default createWorkflow({
  input: z.object({}),
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toEqual([]);
    });

    it("should handle invalid/malformed code gracefully", () => {
      const code = `this is not valid typescript`;

      expect(() => parser.parseWorkflow(code)).not.toThrow();
      const result = parser.parseWorkflow(code);
      expect(result.steps).toEqual([]);
    });

    it("should handle code without createWorkflow export", () => {
      const code = `
const x = 1;
export default x;
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toEqual([]);
      expect(result.inputSchema).toEqual([]);
    });
  });

  describe("real workflow examples", () => {
    it("should parse mspaint-mediar workflow", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const inputSchema = z.object({});

const PROCESS = "mspaint";

const cleanup = createStep({
  id: "cleanup",
  name: "Close Paint and Notepad",
  description: "Close any existing Paint and Notepad instances before starting",
  execute: async ({ desktop, logger }) => {
    logger.info("Closing any existing Paint and Notepad instances...");
    try {
      await desktop.runCommand("taskkill /IM mspaint.exe /F");
    } catch {
      // No instances running
    }
    await desktop.delay(300);
    logger.success("Cleanup complete");
    return { state: {} };
  },
});

const openPaint = createStep({
  id: "open_paint",
  name: "Open MS Paint",
  description: "Opens Microsoft Paint and maximizes the window",
  execute: async ({ desktop, logger }) => {
    logger.info("Opening Microsoft Paint...");
    desktop.openApplication("mspaint.exe");
    await desktop.delay(2000);
    const paintWindow = await desktop.locator(\`process:\${PROCESS} && role:Window\`).first(5000);
    await paintWindow.activateWindow();
    await desktop.pressKey("{Alt}{Space}");
    await desktop.delay(200);
    await desktop.pressKey("x");
    logger.success("Paint opened and maximized");
    return { state: {} };
  },
});

export default createWorkflow({
  input: inputSchema,
  steps: [cleanup, openPaint],
  onError: async ({ error, logger }) => {
    logger.error(\`Workflow failed: \${error.message}\`);
  },
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].id).toBe("cleanup");
      expect(result.steps[0].name).toBe("Close Paint and Notepad");
      expect(result.steps[1].id).toBe("open_paint");
      expect(result.steps[1].name).toBe("Open MS Paint");
      expect(result.hasOnError).toBe(true);

      // Check desktop operations
      expect(result.steps[0].desktopOperations).toContainEqual(expect.objectContaining({ type: "runCommand" }));
      expect(result.steps[1].desktopOperations).toContainEqual(
        expect.objectContaining({ type: "openApplication", application: "mspaint.exe" })
      );
      expect(result.steps[1].desktopOperations).toContainEqual(expect.objectContaining({ type: "locator" }));
      expect(result.steps[1].desktopOperations).toContainEqual(expect.objectContaining({ type: "pressKey" }));
    });

    it("should parse workflow with complex input schema", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  dataFolder: z.string().optional().describe("Custom folder path for test data"),
  outletCode: z.string().default("TEST001").describe("Test outlet code"),
  outletName: z.string().default("Test Outlet").describe("Test outlet name"),
});

const setupStep = createStep({
  id: "setup",
  name: "Setup",
  execute: async ({ input }) => {
    return {
      state: {
        base_folder: input.dataFolder || "/default",
        outlet_code: input.outletCode,
      },
    };
  },
});

export default createWorkflow({
  input: inputSchema,
  steps: [setupStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toHaveLength(3);

      expect(result.inputSchema[0]).toMatchObject({
        name: "dataFolder",
        type: "string",
        required: false,
        description: "Custom folder path for test data",
      });

      expect(result.inputSchema[1]).toMatchObject({
        name: "outletCode",
        type: "string",
        required: false,
        defaultValue: "TEST001",
        description: "Test outlet code",
      });

      expect(result.inputSchema[2]).toMatchObject({
        name: "outletName",
        type: "string",
        required: false,
        defaultValue: "Test Outlet",
        description: "Test outlet name",
      });
    });
  });

  describe("advanced workflow patterns", () => {
    it("should parse workflow with z.enum() input type", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  environment: z.enum(["TEST", "LIVE", "UAT"]).describe("Deployment environment"),
  mode: z.enum(["fast", "normal", "thorough"]).optional().describe("Execution mode"),
});

export default createWorkflow({
  name: "Environment Workflow",
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toHaveLength(2);
      expect(result.inputSchema[0]).toMatchObject({
        name: "environment",
        type: "enum",
        required: true,
        description: "Deployment environment",
      });
      expect(result.inputSchema[0].enumValues).toEqual(["TEST", "LIVE", "UAT"]);
      expect(result.inputSchema[1]).toMatchObject({
        name: "mode",
        type: "enum",
        required: false,
        description: "Execution mode",
      });
    });

    it("should parse workflow with z.array() input type", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  tags: z.array(z.string()).describe("List of tags"),
  ids: z.array(z.number()).optional().describe("Optional list of IDs"),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toHaveLength(2);
      expect(result.inputSchema[0]).toMatchObject({
        name: "tags",
        type: "array",
        required: true,
        description: "List of tags",
      });
      expect(result.inputSchema[1]).toMatchObject({
        name: "ids",
        type: "array",
        required: false,
        description: "Optional list of IDs",
      });
    });

    it("should parse named export workflow", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const setupStep = createStep({
  id: "setup",
  name: "Setup Step",
  execute: async () => ({ state: {} }),
});

export const myNamedWorkflow = createWorkflow({
  name: "Named Export Workflow",
  version: "2.0.0",
  input: z.object({}),
  steps: [setupStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.name).toBe("Named Export Workflow");
      expect(result.version).toBe("2.0.0");
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].id).toBe("setup");
    });

    it("should parse workflow with many imported steps", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";
import { step01_login } from "./steps/01-login";
import { step02_navigate } from "./steps/02-navigate";
import { step03_search } from "./steps/03-search";
import { step04_filter } from "./steps/04-filter";
import { step05_select } from "./steps/05-select";
import { step06_process } from "./steps/06-process";
import { step07_validate } from "./steps/07-validate";
import { step08_submit } from "./steps/08-submit";
import { step09_confirm } from "./steps/09-confirm";
import { step10_logout } from "./steps/10-logout";

const inputSchema = z.object({
  username: z.string().describe("Login username"),
  password: z.string().describe("Login password"),
});

export default createWorkflow({
  name: "Large Workflow",
  input: inputSchema,
  steps: [
    step01_login,
    step02_navigate,
    step03_search,
    step04_filter,
    step05_select,
    step06_process,
    step07_validate,
    step08_submit,
    step09_confirm,
    step10_logout,
  ],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toHaveLength(10);
      expect(result.steps.every(s => s.isImported)).toBe(true);
      expect(result.steps[0].importPath).toBe("./steps/01-login");
      expect(result.steps[9].importPath).toBe("./steps/10-logout");
    });

    it("should parse workflow with mixed inline and imported steps", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";
import { loginStep } from "./steps/login";
import { logoutStep } from "./steps/logout";

const processStep = createStep({
  id: "process",
  name: "Process Data",
  execute: async ({ desktop }) => {
    await desktop.locator("button.submit").first(3000);
    return { state: { processed: true } };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [loginStep, processStep, logoutStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].isImported).toBe(true);
      expect(result.steps[1].isImported).toBe(false);
      expect(result.steps[1].id).toBe("process");
      expect(result.steps[2].isImported).toBe(true);
    });

    it("should parse deeply chained desktop operations", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const complexStep = createStep({
  id: "complex_operations",
  name: "Complex Operations",
  execute: async ({ desktop }) => {
    // Multiple chained methods
    const element = await desktop.locator("role:Button && name:Submit")
      .first(5000);
    await element.click();

    await desktop.locator("role:TextBox")
      .nth(2)
      .waitFor(10000);

    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [complexStep],
});
`;
      const result = parser.parseWorkflow(code);

      // Parser finds locators from nested AST nodes, so we may get duplicates
      // The important thing is we find at least the 2 unique selectors
      const locatorOps = result.steps[0].desktopOperations.filter(op => op.type === "locator");
      expect(locatorOps.length).toBeGreaterThanOrEqual(2);

      // Check that we found both unique selectors
      const selectors = new Set(locatorOps.map(op => op.selector));
      expect(selectors.has("role:Button && name:Submit")).toBe(true);
      expect(selectors.has("role:TextBox")).toBe(true);
    });

    it("should parse template literals with expressions in locators", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const PROCESS_NAME = "chrome";
const BUTTON_NAME = "Submit";

const dynamicStep = createStep({
  id: "dynamic_locator",
  name: "Dynamic Locator",
  execute: async ({ desktop, input }) => {
    await desktop.locator(\`process:\${PROCESS_NAME} && role:Window\`).first(5000);
    await desktop.locator(\`name:\${BUTTON_NAME} && role:Button\`).first(3000);
    await desktop.locator(\`text:\${input.searchTerm}\`).first(2000);
    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({
    searchTerm: z.string(),
  }),
  steps: [dynamicStep],
});
`;
      const result = parser.parseWorkflow(code);

      const locatorOps = result.steps[0].desktopOperations.filter(op => op.type === "locator");
      expect(locatorOps.length).toBeGreaterThanOrEqual(3);

      // Template literals with expressions should have ${...} placeholders
      expect(locatorOps[0].selector).toContain("process:");
      expect(locatorOps[0].selector).toContain("${...}");
    });

    it("should parse workflow with complex nested state", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const dataStep = createStep({
  id: "complex_data",
  name: "Complex Data",
  execute: async ({ context }) => {
    return {
      state: {
        user_info: { id: "123", name: "Test" },
        settings: { theme: "dark" },
        results: ["a", "b", "c"],
        count: 42,
        verified: true,
        timestamp: new Date().toISOString(),
      },
    };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [dataStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].stateKeys).toContain("user_info");
      expect(result.steps[0].stateKeys).toContain("settings");
      expect(result.steps[0].stateKeys).toContain("results");
      expect(result.steps[0].stateKeys).toContain("count");
      expect(result.steps[0].stateKeys).toContain("verified");
      expect(result.steps[0].stateKeys).toContain("timestamp");
    });

    it("should parse workflow with conditional desktop operations", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const conditionalStep = createStep({
  id: "conditional",
  name: "Conditional Step",
  execute: async ({ desktop, input }) => {
    if (input.useFastMode) {
      await desktop.pressKey("{Enter}");
    } else {
      await desktop.locator("button.submit").first(5000);
      await desktop.delay(1000);
    }
    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({
    useFastMode: z.boolean().default(false),
  }),
  steps: [conditionalStep],
});
`;
      const result = parser.parseWorkflow(code);

      // Should find all desktop operations regardless of conditional
      const ops = result.steps[0].desktopOperations;
      expect(ops.some(op => op.type === "pressKey")).toBe(true);
      expect(ops.some(op => op.type === "locator")).toBe(true);
      expect(ops.some(op => op.type === "delay")).toBe(true);
    });

    it("should parse input schema with min/max validators", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";

const inputSchema = z.object({
  retryCount: z.number().min(1).max(10).default(3).describe("Number of retries"),
  timeout: z.number().min(1000).describe("Timeout in ms"),
  name: z.string().min(1).max(100).describe("Name with length limits"),
});

export default createWorkflow({
  input: inputSchema,
  steps: [],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.inputSchema).toHaveLength(3);
      expect(result.inputSchema[0]).toMatchObject({
        name: "retryCount",
        type: "number",
        required: false,
        defaultValue: 3,
        description: "Number of retries",
      });
      expect(result.inputSchema[1]).toMatchObject({
        name: "timeout",
        type: "number",
        required: true,
        description: "Timeout in ms",
      });
    });

    it("should parse workflow with both onSuccess and onError handlers", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const mainStep = createStep({
  id: "main",
  name: "Main Step",
  execute: async () => ({ state: { done: true } }),
});

export default createWorkflow({
  name: "Handled Workflow",
  input: z.object({}),
  steps: [mainStep],
  onSuccess: async ({ context, logger }) => {
    logger.info("Workflow succeeded!");
    return context.state;
  },
  onError: async ({ error, logger }) => {
    logger.error(\`Workflow failed: \${error.message}\`);
  },
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.hasOnSuccess).toBe(true);
      expect(result.hasOnError).toBe(true);
      expect(result.name).toBe("Handled Workflow");
    });

    it("should handle workflow with spread operator in steps array gracefully", () => {
      const code = `
import { createWorkflow, z } from "@mediar-ai/workflow";
import { commonSteps } from "./common";
import { finalStep } from "./final";

export default createWorkflow({
  input: z.object({}),
  steps: [...commonSteps, finalStep],
});
`;
      const result = parser.parseWorkflow(code);

      // Spread elements can't be fully resolved, but should not crash
      // Should at least get the finalStep
      expect(result.steps.some(s => s.id === "finalStep")).toBe(true);
    });
  });

  describe("step analysis - advanced patterns", () => {
    it("should extract WorkflowError throws", () => {
      const code = `
import { createWorkflow, createStep, z, WorkflowError } from "@mediar-ai/workflow";

const validateData = createStep({
  id: "validate_data",
  name: "Validate Data",
  execute: async ({ context, logger }) => {
    if (!context.state.data) {
      throw WorkflowError({
        category: "business",
        code: "MISSING_DATA",
        message: "Data is required but was not found",
        recoverable: false,
      });
    }

    if (context.state.data.length === 0) {
      throw WorkflowError({
        category: "business",
        code: "EMPTY_DATA",
        message: "Data array is empty",
        recoverable: true,
      });
    }

    return { state: { validated: true } };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [validateData],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].workflowErrors).toHaveLength(2);
      expect(result.steps[0].workflowErrors[0]).toMatchObject({
        category: "business",
        code: "MISSING_DATA",
        recoverable: false,
      });
      expect(result.steps[0].workflowErrors[1]).toMatchObject({
        category: "business",
        code: "EMPTY_DATA",
        recoverable: true,
      });
    });

    it("should detect success() early return helper", () => {
      const code = `
import { createWorkflow, createStep, z, success } from "@mediar-ai/workflow";

const checkFiles = createStep({
  id: "check_files",
  name: "Check Files",
  execute: async ({ context, logger }) => {
    const files = context.state.files || [];

    if (files.length === 0) {
      logger.info("No files to process");
      return success({
        message: "No files to process",
        data: { skipped: true },
      });
    }

    return { state: { files_count: files.length } };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [checkFiles],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].hasEarlyReturn).toBe(true);
    });

    it("should extract input field access", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const processData = createStep({
  id: "process_data",
  name: "Process Data",
  execute: async ({ input, logger }) => {
    const folder = input.dataFolder || "/default";
    const env = input.environment;
    const verbose = input.verbose;

    if (verbose) {
      logger.info("Verbose mode enabled");
    }

    return {
      state: {
        folder,
        environment: env,
      },
    };
  },
});

export default createWorkflow({
  input: z.object({
    dataFolder: z.string().optional(),
    environment: z.enum(["TEST", "LIVE"]),
    verbose: z.boolean().default(false),
  }),
  steps: [processData],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].inputAccess).toContain("dataFolder");
      expect(result.steps[0].inputAccess).toContain("environment");
      expect(result.steps[0].inputAccess).toContain("verbose");
    });

    it("should extract context.state reads", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const processStep = createStep({
  id: "process",
  name: "Process",
  execute: async ({ context, logger }) => {
    const fileName = context.state.file_name;
    const outletCode = context.state.outlet_code;
    const jsonData = context.state.json_data;

    logger.info("Processing " + fileName);

    return {
      state: {
        processed: true,
        processed_file: fileName,
      },
    };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [processStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].stateReads).toContain("file_name");
      expect(result.steps[0].stateReads).toContain("outlet_code");
      expect(result.steps[0].stateReads).toContain("json_data");
    });

    it("should extract logger calls with levels", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const loggingStep = createStep({
  id: "logging_step",
  name: "Logging Step",
  execute: async ({ logger }) => {
    logger.info("Starting process...");
    logger.debug("Debug info here");
    logger.warn("This might be a problem");
    logger.error("Something went wrong!");
    logger.success("All done!");

    return { state: {} };
  },
});

export default createWorkflow({
  input: z.object({}),
  steps: [loggingStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].loggerCalls.length).toBeGreaterThanOrEqual(5);
      expect(result.steps[0].loggerCalls.map(c => c.level)).toContain("info");
      expect(result.steps[0].loggerCalls.map(c => c.level)).toContain("debug");
      expect(result.steps[0].loggerCalls.map(c => c.level)).toContain("warn");
      expect(result.steps[0].loggerCalls.map(c => c.level)).toContain("error");
      expect(result.steps[0].loggerCalls.map(c => c.level)).toContain("success");

      // Check message extraction
      const infoCall = result.steps[0].loggerCalls.find(c => c.level === "info");
      expect(infoCall?.message).toBe("Starting process...");
    });

    it("should track state writes separately from state keys", () => {
      const code = `
import { createWorkflow, createStep, z } from "@mediar-ai/workflow";

const initStep = createStep({
  id: "init",
  name: "Initialize",
  execute: async ({ input }) => {
    return {
      state: {
        environment: input.environment || "TEST",
        retry_count: 0,
        error_occurred: "false",
        last_error: null,
      },
    };
  },
});

export default createWorkflow({
  input: z.object({
    environment: z.string().optional(),
  }),
  steps: [initStep],
});
`;
      const result = parser.parseWorkflow(code);

      expect(result.steps[0].stateWrites).toContain("environment");
      expect(result.steps[0].stateWrites).toContain("retry_count");
      expect(result.steps[0].stateWrites).toContain("error_occurred");
      expect(result.steps[0].stateWrites).toContain("last_error");
    });

    it("should parse complex ExampleClient-style step", () => {
      const code = `
import { createWorkflow, createStep, z, WorkflowError, success } from "@mediar-ai/workflow";

const readJsonFile = createStep({
  id: "read_json_file",
  name: "Read JSON file",
  execute: async ({ input, context, logger }) => {
    logger.info("📊 Reading JSON file and preparing data...");

    const baseFolder = input.dataFolder || "/default/path";

    if (!baseFolder) {
      throw WorkflowError({
        category: "business",
        code: "FOLDER_NOT_FOUND",
        message: "Data folder not found",
        recoverable: false,
      });
    }

    const directories = ["dir1", "dir2"]; // Simulated

    if (directories.length === 0) {
      logger.info("📭 No outlet directories found");
      return success({
        message: "No files to process",
        data: { data_folder: baseFolder },
      });
    }

    const outletCode = "TEST001";
    const date = "2024-01-15";

    logger.info("✅ Loaded file: test.json");
    logger.info("📊 Data extracted:");

    return {
      state: {
        has_file: "true",
        file_name: "test.json",
        outlet_code: outletCode,
        date: date,
        total_debit: "1000.00",
        total_credit: "1000.00",
      },
    };
  },
});

export default createWorkflow({
  input: z.object({
    dataFolder: z.string().optional(),
  }),
  steps: [readJsonFile],
});
`;
      const result = parser.parseWorkflow(code);
      const step = result.steps[0];

      // Check all the extracted metadata
      expect(step.id).toBe("read_json_file");
      expect(step.name).toBe("Read JSON file");

      // Input access
      expect(step.inputAccess).toContain("dataFolder");

      // WorkflowErrors
      expect(step.workflowErrors).toHaveLength(1);
      expect(step.workflowErrors[0].code).toBe("FOLDER_NOT_FOUND");
      expect(step.workflowErrors[0].category).toBe("business");

      // Early return
      expect(step.hasEarlyReturn).toBe(true);

      // Logger calls
      expect(step.loggerCalls.length).toBeGreaterThanOrEqual(3);

      // State writes
      expect(step.stateWrites).toContain("has_file");
      expect(step.stateWrites).toContain("file_name");
      expect(step.stateWrites).toContain("outlet_code");
      expect(step.stateWrites).toContain("total_debit");
    });
  });
});
