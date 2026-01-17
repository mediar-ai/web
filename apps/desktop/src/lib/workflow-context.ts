/**
 * Workflow Context Builder
 *
 * Builds system prompts that include workflow context for AI agents
 */

import {
  WORKFLOW_BUILDING_INSTRUCTIONS,
  buildAskModePrompt,
  ASK_MODE_PROMPT_FALLBACK,
  X_MODE_PROMPT,
  buildRecorderModePrompt,
} from "./prompts";
import { RECORDER_MODE_ALLOWED_TOOLS, RECORDER_MODE_BLOCKED_TOOLS } from "./ask-mode-tools";

/**
 * Represents a part of the system prompt with its content and estimated token count
 */
export interface PromptPart {
  name: string;
  content: string;
  tokens: number; // Estimated tokens (chars / 4)
  children?: PromptPart[]; // Nested parts (e.g., individual tools within MCP Instructions)
}

/**
 * Result of building the system prompt, includes breakdown for debugging
 */
export interface SystemPromptResult {
  prompt: string;
  parts: PromptPart[];
  totalTokens: number;
}

/**
 * Estimate token count from string length (rough: ~4 chars per token)
 */
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

export interface StepLocationInfo {
  id: string;
  name?: string;
  sourceFile?: string; // e.g., "src/terminator.ts" or "src/steps/02-login.ts"
  lineStart?: number;
  lineEnd?: number;
}

export interface WorkflowContextOptions {
  workflowName?: string;
  /** Main terminator.ts content for TypeScript workflows */
  terminatorTsContent?: string;
  /** Step-to-file mapping for quick lookup */
  stepMapping?: StepLocationInfo[];
  /** List of files in the workflow folder (relative paths) */
  workflowFiles?: string[];
  /** Local filesystem path to the workflow (for execute_sequence URL) */
  localPath?: string;
  includeEditingInstructions?: boolean;
  mcpTools?: Record<string, any>;
  mcpServerInstructions?: string | null;
  mode?: "ask" | "act" | "x" | "recorder" | "homepage"; // Ask: read-only, Act: full tools, X: execute-only, Recorder: file-editing only, Homepage: app helper
  askModeAllowedTools?: string[]; // List of tools allowed in ask mode (fetched from web app)
  askModeBlockedTools?: string[]; // List of tools blocked in ask mode (fetched from web app)
  /** Recorder mode context - for converting recordings to executable steps */
  recorderContext?: {
    /** Content of analysis_*.md file */
    analysisMarkdown: string;
    /** Synthesized workflow structure */
    synthesisResult: {
      workflows: Array<{
        title: string;
        description: string;
        steps: Array<{
          step_name: string;
          substeps: Array<{
            substep_name: string;
            inputs: string[];
            outputs: string[];
            business_logic: string[];
          }>;
        }>;
      }>;
    };
    /** Per-step analyses with detailed breakdown */
    stepAnalyses: Array<{
      step_title: string;
      step_summary: string;
      events_that_happened: string;
      how_content_changed: string;
      results_if_any: string;
      what_was_clicked: string;
      what_was_typed: string;
      user_intent: string;
      label?: string;
      timestamp: string;
      window_title?: string;
    }>;
    /** Raw recorded events (clicks, typing, etc.) */
    rawEvents: Array<Record<string, unknown>>;
  };
  // Failure context using existing log data
  failureContext?: {
    workflowLog?: {
      stepName: string;
      tool: string;
      consoleLogs: Array<{
        timestamp: number;
        message: string;
        level: "log" | "error" | "warn" | "info";
      }>;
      result?: {
        success: boolean;
        output: unknown; // Raw result object (not stringified) to preserve ui_tree newlines
        error?: string;
      };
      fullResult?: any;
      startTime: number;
      endTime?: number;
      error?: string;
    } | null;
    workflowName: string;
    workflowId?: string | null;
    executionType?: "single_step" | "full";
    stepIndex?: number;
    actualFailedStepName?: string; // The actual step name from failedSteps array
    // NEW: Include the complete execution response for full context
    fullExecutionResponse?: any;
    // Step code extracted from source file
    stepCode?: string | null;
    // Failed step ID for reference
    failedStepId?: string;
  };
}

/**
 * Build failure context prompt section (shared between all modes)
 */
function buildFailureContextPrompt(failureContext: NonNullable<WorkflowContextOptions["failureContext"]>): string {
  let prompt = `\n## EXECUTION FAILURE DETAILS\n\n`;

  // Basic info
  prompt += `**Workflow:** ${failureContext.workflowName}\n`;
  if (failureContext.executionType) {
    prompt += `**Execution Type:** ${failureContext.executionType === "full" ? "Full Workflow" : "Single Step"}\n`;
  }

  // Failed step info
  const stepName = failureContext.actualFailedStepName || failureContext.workflowLog?.stepName || "Unknown step";
  prompt += `**Failed Step:** ${stepName}`;
  if (failureContext.stepIndex !== undefined) {
    prompt += ` (Step ${failureContext.stepIndex + 1})`;
  }
  if (failureContext.failedStepId) {
    prompt += ` [ID: ${failureContext.failedStepId}]`;
  }
  prompt += `\n\n`;

  // Step code
  if (failureContext.stepCode) {
    prompt += `**Step Code:**\n\`\`\`typescript\n${failureContext.stepCode}\n\`\`\`\n\n`;
  }

  // Log-specific details
  const log = failureContext.workflowLog;
  if (log) {
    prompt += `**Status:** ${log.result?.success ? "Success" : "Failed"}\n`;

    if (log.startTime && log.endTime) {
      const duration = ((log.endTime - log.startTime) / 1000).toFixed(2);
      prompt += `**Duration:** ${duration}s\n`;
    }
    prompt += `\n`;

    if (log.error || log.result?.error) {
      const errorMessage = log.error || log.result?.error;
      prompt += `**Error:**\n\`\`\`\n${errorMessage}\n\`\`\`\n\n`;
    }

    if (log.consoleLogs && log.consoleLogs.length > 0) {
      prompt += `**Console Output:**\n\`\`\`\n`;
      log.consoleLogs.forEach(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        prompt += `[${time}] ${entry.level.toUpperCase()}: ${entry.message}\n`;
      });
      prompt += `\`\`\`\n\n`;
    }

    if (log.result?.output) {
      prompt += `**Result:**\n`;
      const output = log.result.output;

      if (typeof output === "object" && output !== null) {
        const outputObj = output as Record<string, unknown>;
        const specialFields = ["ui_tree", "browser_dom", "ocr_tree", "omniparser_tree", "ui_diff"];
        const regularFields: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(outputObj)) {
          if (specialFields.includes(key)) {
            prompt += `\n**${key}:**\n\`\`\`\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n\`\`\`\n`;
          } else {
            regularFields[key] = value;
          }
        }

        if (Object.keys(regularFields).length > 0) {
          prompt += `\n**Other Output:**\n\`\`\`json\n${JSON.stringify(regularFields, null, 2)}\n\`\`\`\n`;
        }
      } else {
        prompt += `\`\`\`\n${typeof output === "string" ? output : JSON.stringify(output, null, 2)}\n\`\`\`\n`;
      }
      prompt += `\n`;
    }
  } else if (failureContext.fullExecutionResponse) {
    // When isError is true, the error message is in content (not error)
    const errorMsg = failureContext.fullExecutionResponse.isError
      ? failureContext.fullExecutionResponse.content
      : failureContext.fullExecutionResponse.error;
    if (errorMsg) {
      prompt += `**Error:**\n\`\`\`\n${errorMsg}\n\`\`\`\n\n`;
    }
  }

  prompt += `---\n\n`;
  return prompt;
}

/**
 * Build a system prompt that includes workflow context
 */
export function buildWorkflowSystemPrompt(options: WorkflowContextOptions): string {
  const {
    workflowName,
    terminatorTsContent,
    stepMapping,
    workflowFiles,
    localPath,
    includeEditingInstructions = true,
    mcpTools,
    mcpServerInstructions,
    mode = "act",
    askModeAllowedTools,
    askModeBlockedTools,
    failureContext,
    recorderContext,
  } = options;

  // Need TS content for workflow context
  if (!terminatorTsContent) {
    return "";
  }

  // ==========================================================================
  // X MODE: Separate prompt - no MCP instructions, but include failure/execution context
  // ==========================================================================
  if (mode === "x") {
    let xPrompt = X_MODE_PROMPT + "\n\n";

    // Add workflow name for context
    if (workflowName) {
      xPrompt += `**Workflow:** ${workflowName}\n\n`;
    }

    // Add local path for execute_sequence
    if (localPath) {
      xPrompt += `**Workflow Path:** ${localPath}\n`;
      xPrompt += `Use execute_sequence to run workflow steps.\n\n`;
    }

    // Add failure context if present (same as other modes)
    if (failureContext) {
      xPrompt += buildFailureContextPrompt(failureContext);
    }

    // Add step mapping with file locations for reference
    if (stepMapping && stepMapping.length > 0) {
      xPrompt += `## STEP-TO-FILE MAPPING\n\n`;
      xPrompt += `Use this mapping to find step definitions (step numbers match UI):\n\n`;
      stepMapping.forEach((step, index) => {
        const location = step.sourceFile
          ? `${step.sourceFile}:${step.lineStart || "?"}-${step.lineEnd || "?"}`
          : "inline";
        xPrompt += `${index + 1}. **${step.id}**${step.name ? ` (${step.name})` : ""}: \`${location}\`\n`;
      });
      xPrompt += `\n`;
    }

    // Always include workflow building instructions (COMMUNICATION PRINCIPLE)
    xPrompt += "\n" + WORKFLOW_BUILDING_INSTRUCTIONS;

    return xPrompt;
  }

  // ==========================================================================
  // RECORDER MODE: File editing only - for converting recordings to steps
  // ==========================================================================
  if (mode === "recorder") {
    let recorderPrompt = buildRecorderModePrompt(RECORDER_MODE_ALLOWED_TOOLS, RECORDER_MODE_BLOCKED_TOOLS);
    recorderPrompt += "\n\n";

    // Add workflow name for context
    if (workflowName) {
      recorderPrompt += `**Workflow:** ${workflowName}\n\n`;
    }

    // Add local path for file operations
    if (localPath) {
      recorderPrompt += `**Workflow Path:** ${localPath}\n\n`;
    }

    // Add step mapping with file locations
    if (stepMapping && stepMapping.length > 0) {
      recorderPrompt += `## STEP-TO-FILE MAPPING\n\n`;
      recorderPrompt += `These are the skeleton step files to implement:\n\n`;
      stepMapping.forEach((step, index) => {
        const location = step.sourceFile
          ? `${step.sourceFile}:${step.lineStart || "?"}-${step.lineEnd || "?"}`
          : "inline";
        recorderPrompt += `${index + 1}. **${step.id}**${step.name ? ` (${step.name})` : ""}: \`${location}\`\n`;
      });
      recorderPrompt += `\n`;
    }

    // Add workflow files list
    if (workflowFiles && workflowFiles.length > 0) {
      recorderPrompt += `## WORKFLOW FILES\n\n`;
      for (const file of workflowFiles) {
        recorderPrompt += `- ${file}\n`;
      }
      recorderPrompt += `\n`;
    }

    // Add recorder context if provided
    if (recorderContext) {
      recorderPrompt += `## RECORDING ANALYSIS\n\n`;
      recorderPrompt += `The following analysis was generated from the recorded session:\n\n`;
      recorderPrompt += "```markdown\n" + recorderContext.analysisMarkdown + "\n```\n\n";

      recorderPrompt += `## STEP ANALYSES (${recorderContext.stepAnalyses.length} steps)\n\n`;
      recorderPrompt += `Detailed breakdown of each recorded step:\n\n`;
      recorderPrompt += "```json\n" + JSON.stringify(recorderContext.stepAnalyses, null, 2) + "\n```\n\n";

      recorderPrompt += `## SYNTHESIS RESULT\n\n`;
      recorderPrompt += `Structured workflow from synthesis:\n\n`;
      recorderPrompt += "```json\n" + JSON.stringify(recorderContext.synthesisResult, null, 2) + "\n```\n\n";

      // Include raw events sample (first 5 to avoid token overflow)
      if (recorderContext.rawEvents && recorderContext.rawEvents.length > 0) {
        const eventSample = recorderContext.rawEvents.slice(0, 5);
        recorderPrompt += `## RAW EVENTS SAMPLE (${recorderContext.rawEvents.length} total, showing first 5)\n\n`;
        recorderPrompt += `Use these to extract selectors, coordinates, and typed text:\n\n`;
        recorderPrompt += "```json\n" + JSON.stringify(eventSample, null, 2) + "\n```\n\n";

        if (recorderContext.rawEvents.length > 5) {
          recorderPrompt += `*Read recordings/*.json files for full event data.*\n\n`;
        }
      }
    }

    // Always include workflow building instructions (COMMUNICATION PRINCIPLE)
    recorderPrompt += "\n" + WORKFLOW_BUILDING_INSTRUCTIONS;

    return recorderPrompt;
  }

  // ==========================================================================
  // ASK/ACT MODE: Standard prompt with MCP instructions
  // ==========================================================================
  let prompt = "";

  // Add ASK_MODE_PROMPT when in ask mode
  if (mode === "ask") {
    // Use dynamic prompt with both lists if available, otherwise fallback
    const hasToolLists =
      askModeAllowedTools && askModeAllowedTools.length > 0 && askModeBlockedTools && askModeBlockedTools.length > 0;
    const askPrompt = hasToolLists
      ? buildAskModePrompt(askModeAllowedTools, askModeBlockedTools)
      : ASK_MODE_PROMPT_FALLBACK;
    prompt += askPrompt;
    prompt += "\n\n";
  }

  // Add failure context details if present (uses shared helper)
  if (failureContext) {
    prompt += buildFailureContextPrompt(failureContext);
  }

  // Add workflow name if provided
  if (workflowName) {
    prompt += `\nWorkflow Name: ${workflowName}\n`;
  }

  // Add editing instructions FIRST (before MCP instructions) - always include for COMMUNICATION PRINCIPLE
  if (includeEditingInstructions) {
    prompt += WORKFLOW_BUILDING_INSTRUCTIONS;

    // Add step-to-file mapping for quick lookup
    if (stepMapping && stepMapping.length > 0) {
      prompt += `\n\n---\n## STEP-TO-FILE MAPPING\n\n`;
      prompt += `Use this mapping to quickly find step definitions (step numbers match UI):\n\n`;
      stepMapping.forEach((step, index) => {
        const location = step.sourceFile
          ? `${step.sourceFile}:${step.lineStart || "?"}-${step.lineEnd || "?"}`
          : "inline";
        prompt += `${index + 1}. **${step.id}**${step.name ? ` (${step.name})` : ""}: \`${location}\`\n`;
      });
    }

    // Add workflow files list (from MCP glob_files - respects .gitignore)
    if (workflowFiles && workflowFiles.length > 0) {
      prompt += `\n---\n## WORKFLOW FILES\n\n`;
      prompt += `Files in this workflow folder:\n`;
      for (const file of workflowFiles) {
        prompt += `• ${file}\n`;
      }
    }

    // Note: Execution instructions moved to WORKFLOW_BUILDING_INSTRUCTIONS in prompts.ts
  }

  // Add MCP server instructions AFTER workflow instructions
  if (mcpServerInstructions) {
    prompt += "\n\n" + mcpServerInstructions + "\n\n";
  }

  // Note: Reminder removed - already covered at top of WORKFLOW_BUILDING_INSTRUCTIONS

  return prompt;
}

/**
 * Build a system prompt with detailed breakdown of each part and token estimates.
 * Use this when you need to display prompt composition to the user.
 */
export function buildWorkflowSystemPromptWithBreakdown(options: WorkflowContextOptions): SystemPromptResult {
  const {
    workflowName,
    terminatorTsContent,
    stepMapping,
    workflowFiles,
    localPath,
    includeEditingInstructions = true,
    mcpServerInstructions,
    mode = "act",
    askModeAllowedTools,
    askModeBlockedTools,
    failureContext,
  } = options;

  const parts: PromptPart[] = [];

  // Helper to add a part
  const addPart = (name: string, content: string) => {
    if (content && content.trim()) {
      parts.push({ name, content, tokens: estimateTokens(content) });
    }
  };

  // Need TS content for workflow context
  if (!terminatorTsContent) {
    return { prompt: "", parts: [], totalTokens: 0 };
  }

  // ==========================================================================
  // X MODE
  // ==========================================================================
  if (mode === "x") {
    addPart("X Mode Prompt", X_MODE_PROMPT);

    if (workflowName) {
      addPart("Workflow Name", `**Workflow:** ${workflowName}\n\n`);
    }

    if (localPath) {
      const pathContent = `**Workflow Path:** ${localPath}\nUse execute_sequence to run workflow steps.\n\n`;
      addPart("Workflow Path", pathContent);
    }

    if (failureContext) {
      addPart("Failure Context", buildFailureContextPrompt(failureContext));
    }

    if (stepMapping && stepMapping.length > 0) {
      let stepContent = `## STEP-TO-FILE MAPPING\n\nUse this mapping to find step definitions (step numbers match UI):\n\n`;
      stepMapping.forEach((step, index) => {
        const location = step.sourceFile
          ? `${step.sourceFile}:${step.lineStart || "?"}-${step.lineEnd || "?"}`
          : "inline";
        stepContent += `${index + 1}. **${step.id}**${step.name ? ` (${step.name})` : ""}: \`${location}\`\n`;
      });
      addPart("Step Mapping", stepContent);
    }

    // Always include workflow building instructions (COMMUNICATION PRINCIPLE)
    addPart("Workflow Instructions", WORKFLOW_BUILDING_INSTRUCTIONS);

    const prompt = parts.map(p => p.content).join("\n");
    const totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
    return { prompt, parts, totalTokens };
  }

  // ==========================================================================
  // ASK/ACT MODE
  // ==========================================================================

  // Mode-specific prompt
  if (mode === "ask") {
    const hasToolLists =
      askModeAllowedTools && askModeAllowedTools.length > 0 && askModeBlockedTools && askModeBlockedTools.length > 0;
    const askPrompt = hasToolLists
      ? buildAskModePrompt(askModeAllowedTools, askModeBlockedTools)
      : ASK_MODE_PROMPT_FALLBACK;
    addPart("Ask Mode Prompt", askPrompt + "\n\n");
  }

  // Failure context
  if (failureContext) {
    addPart("Failure Context", buildFailureContextPrompt(failureContext));
  }

  // Workflow name
  if (workflowName) {
    addPart("Workflow Name", `\nWorkflow Name: ${workflowName}\n`);
  }

  // Editing instructions - always include for COMMUNICATION PRINCIPLE
  if (includeEditingInstructions) {
    addPart("Workflow Instructions", WORKFLOW_BUILDING_INSTRUCTIONS);

    // Step mapping
    if (stepMapping && stepMapping.length > 0) {
      let stepContent = `\n\n---\n## STEP-TO-FILE MAPPING\n\nUse this mapping to quickly find step definitions (step numbers match UI):\n\n`;
      stepMapping.forEach((step, index) => {
        const location = step.sourceFile
          ? `${step.sourceFile}:${step.lineStart || "?"}-${step.lineEnd || "?"}`
          : "inline";
        stepContent += `${index + 1}. **${step.id}**${step.name ? ` (${step.name})` : ""}: \`${location}\`\n`;
      });
      addPart("Step Mapping", stepContent);
    }

    // Workflow files (from MCP glob_files - respects .gitignore)
    if (workflowFiles && workflowFiles.length > 0) {
      let filesContent = `\n---\n## WORKFLOW FILES\n\nFiles in this workflow folder:\n`;
      for (const file of workflowFiles) {
        filesContent += `• ${file}\n`;
      }
      addPart("Workflow Files", filesContent);
    }

    // Note: Execution instructions moved to WORKFLOW_BUILDING_INSTRUCTIONS in prompts.ts
  }

  // MCP server instructions (without tool definitions)
  if (mcpServerInstructions) {
    // The server instructions include tool definitions - we'll track tools separately
    addPart("MCP Instructions", "\n\n" + mcpServerInstructions + "\n\n");
  }

  // Tool definitions tokens are calculated in useWebAppChat.ts from the actual API payload

  const prompt = parts.map(p => p.content).join("");
  const totalTokens = parts.reduce((sum, p) => sum + p.tokens, 0);
  return { prompt, parts, totalTokens };
}

/**
 * Build a system prompt for Claude Code (excludes MCP instructions since they come via MCP server)
 * This is a simplified version of buildWorkflowSystemPrompt that only includes:
 * - Mode-specific prompt (Ask/Act/X)
 * - Failure context
 * - Workflow name
 * - Workflow instructions
 * - Step mapping
 * - Workflow files
 */
export function buildClaudeCodeSystemPrompt(options: WorkflowContextOptions): string {
  // Build the full prompt but explicitly pass null for mcpServerInstructions
  // This ensures we get all the workflow context without MCP tool docs
  const modifiedOptions: WorkflowContextOptions = {
    ...options,
    mcpServerInstructions: null, // Claude Code gets this via MCP server connection
  };

  const prompt = buildWorkflowSystemPrompt(modifiedOptions);

  if (prompt) {
    console.log(
      `[WORKFLOW-CONTEXT] Built Claude Code system prompt: ${prompt.length} chars (mode=${options.mode || "act"})`
    );
  }

  return prompt;
}
