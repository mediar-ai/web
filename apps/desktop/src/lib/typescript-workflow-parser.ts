/**
 * TypeScript Workflow Parser
 * Parses TypeScript workflow files (terminator.ts) to extract structured metadata
 * for visualization in the UI.
 *
 * Uses Babel parser for browser compatibility.
 */

import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

// ============================================================================
// Types
// ============================================================================

export interface ParsedSection {
  type: "input" | "steps" | "onError" | "onSuccess" | "trigger";
  lineStart: number;
  lineEnd: number;
}

// Trigger configuration types (matching terminator SDK)
export interface CronTrigger {
  type: "cron";
  schedule: string;
  timezone?: string;
  enabled?: boolean;
}

export interface ManualTrigger {
  type: "manual";
}

export interface WebhookTrigger {
  type: "webhook";
  path?: string;
}

export type TriggerConfig = CronTrigger | ManualTrigger | WebhookTrigger;

export interface ParsedWorkflow {
  name?: string;
  version?: string;
  inputSchema: ParsedInputField[];
  steps: ParsedStep[];
  hasOnSuccess: boolean;
  hasOnError: boolean;
  trigger?: TriggerConfig;
  sections: ParsedSection[];
}

export interface ParsedInputField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "enum" | "unknown";
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  enumValues?: string[];
}

export interface DesktopOperation {
  type: "locator" | "runCommand" | "openApplication" | "pressKey" | "delay" | "other";
  selector?: string;
  command?: string;
  application?: string;
  keys?: string;
  duration?: number;
}

export interface WorkflowErrorInfo {
  code?: string;
  category?: string;
  message?: string;
  recoverable?: boolean;
}

export interface ParsedStep {
  id: string;
  name?: string;
  description?: string;
  sourceFile?: string; // File path relative to src/, e.g., "src/terminator.ts" or "src/steps/myStep.ts"
  lineStart?: number; // Line number where step definition starts
  lineEnd?: number; // Line number where step definition ends
  desktopOperations: DesktopOperation[];
  stateKeys: string[];
  isImported: boolean;
  importPath?: string;
  // Advanced analysis
  inputAccess: string[]; // input.xxx fields accessed
  stateReads: string[]; // context.state.xxx reads
  stateWrites: string[]; // state keys written in return
  loggerCalls: Array<{ level: string; message?: string }>;
  workflowErrors: WorkflowErrorInfo[];
  hasEarlyReturn: boolean; // Uses success() helper
}

// ============================================================================
// Parser Implementation
// ============================================================================

export class TypeScriptWorkflowParser {
  /**
   * Parse a TypeScript workflow file and extract structured metadata
   */
  parseWorkflow(code: string): ParsedWorkflow {
    const result: ParsedWorkflow = {
      inputSchema: [],
      steps: [],
      hasOnSuccess: false,
      hasOnError: false,
      sections: [],
    };

    try {
      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });

      // Collect step definitions and imports
      const stepDefinitions = new Map<string, ParsedStep>();
      const importedSteps = new Map<string, string>(); // varName -> importPath
      const zodSchemas = new Map<string, t.Node>(); // varName -> z.object node

      // First pass: collect imports, step definitions, and zod schemas

      traverse(ast as any, {
        ImportDeclaration: path => {
          this.collectImport(path.node, importedSteps);
        },
        VariableDeclarator: path => {
          const node = path.node;
          if (t.isIdentifier(node.id as any) && node.init) {
            const varName = (node.id as any).name;

            // Check for createStep
            if (this.isCreateStepCall(node.init)) {
              const stepDef = this.parseCreateStepCall(node.init);
              if (stepDef) {
                // Capture line numbers from the entire VariableDeclarator node
                if (node.loc) {
                  stepDef.lineStart = node.loc.start.line;
                  stepDef.lineEnd = node.loc.end.line;
                }
                stepDefinitions.set(varName, stepDef);
              }
            }

            // Check for z.object schema
            if (this.isZodObjectCall(node.init)) {
              zodSchemas.set(varName, node.init as any);
            }
          }
        },
      });

      // Second pass: find createWorkflow call and extract metadata

      traverse(ast as any, {
        CallExpression: path => {
          if (this.isCreateWorkflowCall(path.node)) {
            this.parseCreateWorkflowCall(path.node, result, stepDefinitions, importedSteps, zodSchemas);
          }
        },
      });
    } catch (error) {
      console.error("[parseStepFile] Error parsing file:", error);
      // Return empty result for invalid code
    }

    return result;
  }

  // ==========================================================================
  // Import Collection
  // ==========================================================================

  private collectImport(node: any, importedSteps: Map<string, string>): void {
    const importPath = node.source.value;

    // Skip @mediar-ai/workflow imports
    if (importPath.includes("@mediar-ai/workflow")) {
      return;
    }

    // Collect named imports
    for (const specifier of node.specifiers) {
      if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.imported)) {
        const name = specifier.local.name;
        importedSteps.set(name, importPath);
      }
    }
  }

  // ==========================================================================
  // Step Definition Parsing
  // ==========================================================================

  private isCreateStepCall(node: any): boolean {
    return t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "createStep";
  }

  private parseCreateStepCall(node: any): ParsedStep | null {
    const args = node.arguments;
    if (args.length === 0 || !t.isObjectExpression(args[0])) return null;

    const configObj = args[0];
    const step: ParsedStep = {
      id: "",
      desktopOperations: [],
      stateKeys: [],
      isImported: false,
      inputAccess: [],
      stateReads: [],
      stateWrites: [],
      loggerCalls: [],
      workflowErrors: [],
      hasEarlyReturn: false,
    };

    for (const prop of configObj.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      const propName = prop.key.name;
      const propValue = prop.value;

      switch (propName) {
        case "id":
          if (t.isStringLiteral(propValue)) {
            step.id = propValue.value;
          }
          break;
        case "name":
          if (t.isStringLiteral(propValue)) {
            step.name = propValue.value;
          }
          break;
        case "description":
          if (t.isStringLiteral(propValue)) {
            step.description = propValue.value;
          }
          break;
        case "execute":
          this.parseExecuteFunction(propValue, step);
          break;
      }
    }

    return step.id ? step : null;
  }

  // ==========================================================================
  // Execute Function Parsing
  // ==========================================================================

  private parseExecuteFunction(node: any, step: ParsedStep): void {
    if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node)) return;

    const wrappedAst = t.file(t.program([t.expressionStatement(node as any)]));

    traverse(
      wrappedAst as any,
      {
        CallExpression: path => {
          this.extractDesktopOperation(path.node, step);
          this.extractLoggerCall(path.node, step);
          this.extractWorkflowError(path.node, step);
          this.extractSuccessCall(path.node, step);
        },
        MemberExpression: path => {
          this.extractInputAccess(path.node, step);
          this.extractStateRead(path.node, step);
        },
        ReturnStatement: path => {
          if (path.node.argument) {
            this.extractStateKeys(path.node.argument, step);
          }
        },
      },
      undefined,
      { step }
    );
  }

  private extractLoggerCall(node: any, step: ParsedStep): void {
    if (!t.isMemberExpression(node.callee)) return;

    const obj = node.callee.object;
    const prop = node.callee.property;

    if (t.isIdentifier(obj) && obj.name === "logger" && t.isIdentifier(prop)) {
      const level = prop.name;
      if (["info", "error", "warn", "debug", "success"].includes(level)) {
        const message = node.arguments.length > 0 ? this.getStringValue(node.arguments[0]) : undefined;
        step.loggerCalls.push({ level, message: message || undefined });
      }
    }
  }

  private extractWorkflowError(node: any, step: ParsedStep): void {
    // Check for WorkflowError({ ... }) or throw WorkflowError({ ... })
    if (!t.isIdentifier(node.callee) || node.callee.name !== "WorkflowError") return;

    if (node.arguments.length === 0 || !t.isObjectExpression(node.arguments[0])) return;

    const errorInfo: WorkflowErrorInfo = {};
    const configObj = node.arguments[0];

    for (const prop of configObj.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      const propName = prop.key.name;
      const propValue = prop.value;

      switch (propName) {
        case "code":
          if (t.isStringLiteral(propValue)) {
            errorInfo.code = propValue.value;
          }
          break;
        case "category":
          if (t.isStringLiteral(propValue)) {
            errorInfo.category = propValue.value;
          }
          break;
        case "message":
          errorInfo.message = this.getStringValue(propValue) || undefined;
          break;
        case "recoverable":
          if (t.isBooleanLiteral(propValue)) {
            errorInfo.recoverable = propValue.value;
          }
          break;
      }
    }

    step.workflowErrors.push(errorInfo);
  }

  private extractSuccessCall(node: any, step: ParsedStep): void {
    // Check for success({ ... }) helper
    if (t.isIdentifier(node.callee) && node.callee.name === "success") {
      step.hasEarlyReturn = true;
    }
  }

  private extractInputAccess(node: any, step: ParsedStep): void {
    // Look for input.xxx patterns
    if (!t.isIdentifier(node.object) || node.object.name !== "input") return;
    if (!t.isIdentifier(node.property)) return;

    const fieldName = node.property.name;
    if (!step.inputAccess.includes(fieldName)) {
      step.inputAccess.push(fieldName);
    }
  }

  private extractStateRead(node: any, step: ParsedStep): void {
    // Look for context.state.xxx patterns
    if (!t.isMemberExpression(node.object)) return;

    const inner = node.object;
    if (
      t.isIdentifier(inner.object) &&
      inner.object.name === "context" &&
      t.isIdentifier(inner.property) &&
      inner.property.name === "state" &&
      t.isIdentifier(node.property)
    ) {
      const fieldName = node.property.name;
      if (!step.stateReads.includes(fieldName)) {
        step.stateReads.push(fieldName);
      }
    }
  }

  private extractDesktopOperation(node: any, step: ParsedStep): void {
    // Handle chained calls like desktop.locator(...).first(...)
    // We need to find the root desktop.xxx() call
    const desktopCall = this.findDesktopCall(node);
    if (!desktopCall) return;

    const callee = desktopCall.callee as t.MemberExpression;
    const prop = callee.property;

    if (!t.isIdentifier(prop)) return;

    const methodName = prop.name;
    const args = desktopCall.arguments;

    switch (methodName) {
      case "locator":
        if (args.length > 0) {
          const selector = this.getStringValue(args[0]);
          if (selector) {
            step.desktopOperations.push({ type: "locator", selector });
          }
        }
        break;
      case "runCommand":
        if (args.length > 0) {
          const command = this.getStringValue(args[0]);
          if (command) {
            step.desktopOperations.push({ type: "runCommand", command });
          }
        }
        break;
      case "openApplication":
        if (args.length > 0) {
          const application = this.getStringValue(args[0]);
          if (application) {
            step.desktopOperations.push({ type: "openApplication", application });
          }
        }
        break;
      case "pressKey":
        if (args.length > 0) {
          const keys = this.getStringValue(args[0]);
          if (keys) {
            step.desktopOperations.push({ type: "pressKey", keys });
          }
        }
        break;
      case "delay":
        if (args.length > 0 && t.isNumericLiteral(args[0])) {
          step.desktopOperations.push({ type: "delay", duration: args[0].value });
        }
        break;
    }
  }

  private findDesktopCall(node: any): any {
    // Check if this is directly desktop.xxx(...)
    if (t.isMemberExpression(node.callee)) {
      const obj = node.callee.object;
      const prop = node.callee.property;

      if (t.isIdentifier(obj) && obj.name === "desktop" && t.isIdentifier(prop)) {
        return node;
      }

      // Check for chained call: desktop.locator(...).first(...)
      // In this case, node.callee.object is the CallExpression desktop.locator(...)
      if (t.isCallExpression(obj)) {
        return this.findDesktopCall(obj);
      }
    }

    return null;
  }

  private extractStateKeys(node: any, step: ParsedStep): void {
    if (!t.isObjectExpression(node)) return;

    for (const prop of node.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      if (prop.key.name === "state" && t.isObjectExpression(prop.value)) {
        for (const stateProp of prop.value.properties) {
          if (t.isObjectProperty(stateProp) && t.isIdentifier(stateProp.key)) {
            const keyName = stateProp.key.name;
            step.stateKeys.push(keyName);
            // Also populate stateWrites for dependency tracking
            if (!step.stateWrites.includes(keyName)) {
              step.stateWrites.push(keyName);
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // createWorkflow Parsing
  // ==========================================================================

  private isCreateWorkflowCall(node: any): boolean {
    return t.isIdentifier(node.callee) && node.callee.name === "createWorkflow";
  }

  private parseCreateWorkflowCall(
    node: any,
    result: ParsedWorkflow,
    stepDefinitions: Map<string, ParsedStep>,
    importedSteps: Map<string, string>,

    zodSchemas: Map<string, any>
  ): void {
    const args = node.arguments;
    if (args.length === 0 || !t.isObjectExpression(args[0])) return;

    const configObj = args[0];

    for (const prop of configObj.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      const propName = prop.key.name;
      const propValue = prop.value;

      switch (propName) {
        case "name":
          if (t.isStringLiteral(propValue)) {
            result.name = propValue.value;
          }
          break;
        case "version":
          if (t.isStringLiteral(propValue)) {
            result.version = propValue.value;
          }
          break;
        case "input": {
          result.inputSchema = this.parseInputSchema(propValue, zodSchemas);
          // Resolve variable reference to get actual schema location
          let inputLoc = propValue.loc;
          if (t.isIdentifier(propValue)) {
            const schemaNode = zodSchemas.get(propValue.name);
            if (schemaNode?.loc) {
              inputLoc = schemaNode.loc;
            }
          }
          if (inputLoc) {
            result.sections.push({
              type: "input",
              lineStart: inputLoc.start.line,
              lineEnd: inputLoc.end.line,
            });
          }
          break;
        }
        case "steps":
          this.parseStepsArray(propValue, result, stepDefinitions, importedSteps);
          if (propValue.loc) {
            result.sections.push({
              type: "steps",
              lineStart: propValue.loc.start.line,
              lineEnd: propValue.loc.end.line,
            });
          }
          break;
        case "onSuccess":
          result.hasOnSuccess = true;
          if (propValue.loc) {
            result.sections.push({
              type: "onSuccess",
              lineStart: propValue.loc.start.line,
              lineEnd: propValue.loc.end.line,
            });
          }
          break;
        case "onError":
          result.hasOnError = true;
          if (propValue.loc) {
            result.sections.push({
              type: "onError",
              lineStart: propValue.loc.start.line,
              lineEnd: propValue.loc.end.line,
            });
          }
          break;
        case "trigger":
          result.trigger = this.parseTriggerConfig(propValue);
          if (propValue.loc) {
            result.sections.push({
              type: "trigger",
              lineStart: propValue.loc.start.line,
              lineEnd: propValue.loc.end.line,
            });
          }
          break;
      }
    }
  }

  // ==========================================================================
  // Trigger Config Parsing
  // ==========================================================================

  private parseTriggerConfig(node: any): TriggerConfig | undefined {
    if (!t.isObjectExpression(node)) return undefined;

    let triggerType: string | undefined;
    let schedule: string | undefined;
    let timezone: string | undefined;
    let path: string | undefined;
    let enabled: boolean | undefined;

    for (const prop of node.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      const propName = prop.key.name;
      const propValue = prop.value;

      switch (propName) {
        case "type":
          if (t.isStringLiteral(propValue)) {
            triggerType = propValue.value;
          }
          break;
        case "schedule":
          if (t.isStringLiteral(propValue)) {
            schedule = propValue.value;
          }
          break;
        case "timezone":
          if (t.isStringLiteral(propValue)) {
            timezone = propValue.value;
          }
          break;
        case "path":
          if (t.isStringLiteral(propValue)) {
            path = propValue.value;
          }
          break;
        case "enabled":
          if (t.isBooleanLiteral(propValue)) {
            enabled = propValue.value;
          }
          break;
      }
    }

    if (!triggerType) return undefined;

    switch (triggerType) {
      case "cron":
        if (schedule) {
          return { type: "cron", schedule, timezone, enabled };
        }
        break;
      case "manual":
        return { type: "manual" };
      case "webhook":
        return { type: "webhook", path };
    }

    return undefined;
  }

  // ==========================================================================
  // Input Schema Parsing
  // ==========================================================================

  private isZodObjectCall(node: any): boolean {
    if (!t.isCallExpression(node)) return false;

    // Check for z.object({...}) or z.object({...}).optional()
    let callExpr = node;
    while (t.isCallExpression(callExpr)) {
      if (t.isMemberExpression(callExpr.callee)) {
        const obj = callExpr.callee.object;
        const prop = callExpr.callee.property;

        if (t.isIdentifier(obj) && obj.name === "z" && t.isIdentifier(prop) && prop.name === "object") {
          return true;
        }

        // Keep walking for chained calls like z.object({}).optional()
        if (t.isCallExpression(obj)) {
          callExpr = obj;
          continue;
        }
      }
      break;
    }
    return false;
  }

  private parseInputSchema(node: any, zodSchemas: Map<string, any>): ParsedInputField[] {
    const fields: ParsedInputField[] = [];

    // Handle variable reference (e.g., `input: inputSchema`)
    if (t.isIdentifier(node)) {
      const schemaNode = zodSchemas.get(node.name);
      if (schemaNode) {
        return this.parseInputSchema(schemaNode, zodSchemas);
      }
      return fields;
    }

    // Find the z.object({...}) call
    const objectCall = this.findZodObjectCall(node);
    if (!objectCall || objectCall.arguments.length === 0) return fields;

    const objArg = objectCall.arguments[0];
    if (!t.isObjectExpression(objArg)) return fields;

    // Parse each field
    for (const prop of objArg.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      const fieldName = prop.key.name;
      const field = this.parseZodFieldDefinition(fieldName, prop.value);
      if (field) {
        fields.push(field);
      }
    }

    return fields;
  }

  private findZodObjectCall(node: any): any {
    if (!t.isCallExpression(node)) return null;

    // Check if this is z.object(...)
    if (t.isMemberExpression(node.callee)) {
      const obj = node.callee.object;
      const prop = node.callee.property;

      if (t.isIdentifier(obj) && obj.name === "z" && t.isIdentifier(prop) && prop.name === "object") {
        return node;
      }

      // It's a chained call like z.object({}).optional() - recurse
      if (t.isCallExpression(obj)) {
        return this.findZodObjectCall(obj);
      }
    }

    return null;
  }

  private parseZodFieldDefinition(name: string, node: t.Node): ParsedInputField | null {
    const field: ParsedInputField = {
      name,
      type: "unknown",
      required: true,
    };

    this.walkZodChain(node, field);
    return field;
  }

  private walkZodChain(node: any, field: ParsedInputField): void {
    if (!t.isCallExpression(node)) return;

    if (t.isMemberExpression(node.callee)) {
      const obj = node.callee.object;
      const prop = node.callee.property;

      if (!t.isIdentifier(prop)) return;

      const methodName = prop.name;
      const args = node.arguments;

      // Check for z.xxx() type methods
      if (t.isIdentifier(obj) && obj.name === "z") {
        switch (methodName) {
          case "string":
            field.type = "string";
            break;
          case "number":
            field.type = "number";
            break;
          case "boolean":
            field.type = "boolean";
            break;
          case "object":
            field.type = "object";
            break;
          case "array":
            field.type = "array";
            break;
          case "enum":
            field.type = "enum";
            // Extract enum values from z.enum(["A", "B", "C"])
            if (args.length > 0 && t.isArrayExpression(args[0])) {
              field.enumValues = args[0].elements
                .filter((el): el is t.StringLiteral => t.isStringLiteral(el))
                .map(el => el.value);
            }
            break;
        }
      } else {
        // Modifier methods on chained calls
        switch (methodName) {
          case "optional":
            field.required = false;
            break;
          case "default":
            field.required = false;
            if (args.length > 0) {
              field.defaultValue = this.getLiteralValue(args[0]);
            }
            break;
          case "describe":
            if (args.length > 0 && t.isStringLiteral(args[0])) {
              field.description = args[0].value;
            }
            break;
        }

        // Continue walking the chain
        if (t.isCallExpression(obj)) {
          this.walkZodChain(obj, field);
        }
      }
    }
  }

  // ==========================================================================
  // Steps Array Parsing
  // ==========================================================================

  private parseStepsArray(
    node: t.Node,
    result: ParsedWorkflow,
    stepDefinitions: Map<string, ParsedStep>,
    importedSteps: Map<string, string>
  ): void {
    if (!t.isArrayExpression(node)) return;

    for (const element of node.elements) {
      if (!element || !t.isIdentifier(element)) continue;

      const stepName = element.name;

      // Check if it's a locally defined step
      const localStep = stepDefinitions.get(stepName);
      if (localStep) {
        // Set sourceFile for locally defined steps
        localStep.sourceFile = "src/terminator.ts";
        result.steps.push(localStep);
        continue;
      }

      // Check if it's an imported step
      const importPath = importedSteps.get(stepName);
      if (importPath) {
        // Convert importPath (./steps/myStep) to sourceFile (src/steps/myStep.ts)
        const sourceFile = this.importPathToSourceFile(importPath);
        result.steps.push({
          id: stepName,
          isImported: true,
          importPath,
          sourceFile,
          desktopOperations: [],
          stateKeys: [],
          inputAccess: [],
          stateReads: [],
          stateWrites: [],
          loggerCalls: [],
          workflowErrors: [],
          hasEarlyReturn: false,
        });
      }
    }
  }

  /**
   * Convert import path to source file path
   * e.g., "./steps/myStep" -> "src/steps/myStep.ts"
   */
  private importPathToSourceFile(importPath: string): string {
    // Remove leading ./ and add src/ prefix and .ts extension
    let path = importPath;
    if (path.startsWith("./")) {
      path = path.slice(2);
    }
    // Add .ts extension if not present
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) {
      path = path + ".ts";
    }
    return `src/${path}`;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private getStringValue(node: any): string | null {
    if (t.isStringLiteral(node)) {
      return node.value;
    }
    if (t.isTemplateLiteral(node)) {
      // For template literals, return a reconstructed string
      // with ${...} placeholders for expressions
      if (node.quasis.length === 1) {
        return node.quasis[0].value.raw;
      }
      // Template with expressions - reconstruct with placeholders
      let result = "";
      for (let i = 0; i < node.quasis.length; i++) {
        result += node.quasis[i].value.raw;
        if (i < node.expressions.length) {
          result += "${...}";
        }
      }
      return result;
    }
    return null;
  }

  private getLiteralValue(node: any): unknown {
    if (t.isStringLiteral(node)) {
      return node.value;
    }
    if (t.isNumericLiteral(node)) {
      return node.value;
    }
    if (t.isBooleanLiteral(node)) {
      return node.value;
    }
    if (t.isNullLiteral(node)) {
      return null;
    }
    return undefined;
  }

  // ==========================================================================
  // Step File Parsing (for imported steps)
  // ==========================================================================

  /**
   * Parse a step file to extract the step definition with line numbers.
   * This is used to enrich imported steps with their line numbers.
   * @param code The source code of the file
   * @param targetStepId Optional step ID to find a specific step in multi-step files
   */
  parseStepFile(
    code: string,
    targetStepId?: string
  ): { lineStart?: number; lineEnd?: number; step?: ParsedStep } | null {
    try {
      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });

      let result: { lineStart?: number; lineEnd?: number; step?: ParsedStep } | null = null;
      const allSteps: Array<{ lineStart: number; lineEnd: number; step: ParsedStep; variableName: string }> = [];

      traverse(ast as any, {
        // Look for: export const stepName = createStep({...})
        VariableDeclarator: path => {
          const node = path.node;
          if (t.isIdentifier(node.id as any) && node.init && this.isCreateStepCall(node.init)) {
            const stepDef = this.parseCreateStepCall(node.init as t.CallExpression);
            if (stepDef && node.loc) {
              stepDef.lineStart = node.loc.start.line;
              stepDef.lineEnd = node.loc.end.line;
              // Store both the variable name (e.g., "dismissPasswordDialog") and step info
              allSteps.push({
                lineStart: node.loc.start.line,
                lineEnd: node.loc.end.line,
                step: stepDef,
                variableName: (node.id as any).name, // The exported variable name
              });
            }
          }
        },
      });

      // If a specific step ID is requested, find it by variable name OR step config id
      if (targetStepId) {
        // First try matching by variable name (how steps are referenced in terminator.ts)
        let matchingStep = allSteps.find(s => s.variableName === targetStepId);
        // Fall back to matching by step config id
        if (!matchingStep) {
          matchingStep = allSteps.find(s => s.step.id === targetStepId);
        }
        if (matchingStep) {
          console.log(
            "[parseStepFile] Found match:",
            matchingStep.variableName,
            "lines:",
            matchingStep.lineStart,
            "-",
            matchingStep.lineEnd
          );
          result = matchingStep;
        } else {
          console.log("[parseStepFile] No match found for:", targetStepId);
        }
      } else if (allSteps.length > 0) {
        // Backward compatible: return first step if no specific ID requested
        result = allSteps[0];
      }

      return result;
    } catch (error) {
      console.error("[parseStepFile] Error parsing file:", error);
      return null;
    }
  }

  /**
   * Parse all steps from a step file (e.g., src/steps/01-main.ts).
   * Returns all step definitions with their metadata.
   */
  parseAllStepsFromFile(code: string): ParsedStep[] {
    try {
      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });

      const steps: ParsedStep[] = [];

      traverse(ast as any, {
        VariableDeclarator: path => {
          const node = path.node;
          if (t.isIdentifier(node.id as any) && node.init && this.isCreateStepCall(node.init)) {
            const stepDef = this.parseCreateStepCall(node.init as t.CallExpression);
            if (stepDef && node.loc) {
              stepDef.lineStart = node.loc.start.line;
              stepDef.lineEnd = node.loc.end.line;
              steps.push(stepDef);
            }
          }
        },
      });

      return steps;
    } catch (error) {
      console.error("[parseAllStepsFromFile] Error parsing file:", error);
      return [];
    }
  }

  /**
   * Enrich steps with line numbers by parsing their source files.
   * Call this after parseWorkflow to fill in lineStart/lineEnd for imported steps.
   */
  enrichStepsWithLineNumbers(steps: ParsedStep[], files: Array<{ path: string; content: string }>): void {
    console.log("[PARSER] enrichStepsWithLineNumbers called with", steps.length, "steps,", files.length, "files");
    console.log(
      "[PARSER] Available files:",
      files.map(f => f.path)
    );

    for (const step of steps) {
      console.log("[PARSER] Processing step:", step.id, "sourceFile:", step.sourceFile, "lineStart:", step.lineStart);

      // Skip if already has line numbers (inline steps)
      if (step.lineStart !== undefined && step.lineEnd !== undefined) {
        console.log("[PARSER] Step already has line numbers:", step.lineStart, "-", step.lineEnd);
        continue;
      }

      // Find the source file
      if (step.sourceFile) {
        const file = files.find(f => {
          // Normalize paths for comparison
          const normalizedFilePath = f.path.replace(/\\/g, "/");
          const normalizedSourceFile = step.sourceFile!.replace(/\\/g, "/");
          const matches =
            normalizedFilePath === normalizedSourceFile ||
            normalizedFilePath.endsWith(normalizedSourceFile) ||
            normalizedSourceFile.endsWith(normalizedFilePath);
          return matches;
        });

        if (file) {
          console.log("[PARSER] Found file for step:", file.path, "looking for step ID:", step.id);
          const parsed = this.parseStepFile(file.content, step.id);
          console.log("[PARSER] Parsed step file result:", parsed);
          if (parsed) {
            step.lineStart = parsed.lineStart;
            step.lineEnd = parsed.lineEnd;
            console.log("[PARSER] Set line numbers for step", step.id, ":", step.lineStart, "-", step.lineEnd);
            // Also enrich with parsed step details if available
            if (parsed.step) {
              // Update the step ID to use the actual ID from createStep({ id: "..." })
              // instead of the variable name (e.g., "init" instead of "initWorkflow")
              step.id = parsed.step.id;
              step.name = step.name || parsed.step.name;
              step.description = step.description || parsed.step.description;
              step.desktopOperations = parsed.step.desktopOperations;
              step.inputAccess = parsed.step.inputAccess;
              step.stateReads = parsed.step.stateReads;
              step.stateWrites = parsed.step.stateWrites;
              step.loggerCalls = parsed.step.loggerCalls;
              step.workflowErrors = parsed.step.workflowErrors;
              step.hasEarlyReturn = parsed.step.hasEarlyReturn;
            }
          }
        }
      }
    }
  }
}
