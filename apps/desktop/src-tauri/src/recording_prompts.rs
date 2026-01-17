//! Recording processing prompts
//!
//! Ported from mediar-web-app/apps/web/src/lib/prompts.ts
//! These prompts are used for local recording processing using Gemini Vertex AI.

/// Schema for step analysis output (matches WORKFLOW_STEP_ANALYSIS_SCHEMA)
pub const STEP_ANALYSIS_SCHEMA: &str = r#"{
    "type": "object",
    "properties": {
        "step_title": { "type": "string" },
        "step_summary": { "type": "string" },
        "events_that_happened": { "type": "string" },
        "how_content_changed": { "type": "string" },
        "results_if_any": { "type": "string" },
        "what_was_clicked": { "type": "string" },
        "what_was_typed": { "type": "string" },
        "user_intent": { "type": "string" }
    },
    "required": ["step_title", "step_summary", "events_that_happened", "how_content_changed", "results_if_any", "what_was_clicked", "what_was_typed", "user_intent"]
}"#;

/// Prompt for analyzing a single workflow step
/// Ported from WORKFLOW_STEP_ANALYSIS_V2_PROMPT
pub const WORKFLOW_STEP_ANALYSIS_PROMPT: &str = r#"You are an expert workflow analyst. Your task is to analyze a collection of contextual data representing a single moment in a user's workflow and describe it using a detailed, action-focused structure.

The user has provided the following context, based on their screen, UI structure, and recent events:
- Screenshots (before and after an action)
- UI Trees (the accessibility tree before and after an action). In these trees, Roman numerals (I, II, III, etc.) at the beginning of a line indicate the hierarchical depth of the UI element.
- A stream of low-level events (mouse clicks, keystrokes, etc.)
- The three most recent workflow steps that were previously analyzed.

Based on this context, your goal is to capture the user's action and its results in comprehensive detail.

For any requested field where information is not clearly evident in the provided context, use 'Not available in data' rather than inferring or creating details.

OUTPUT FORMAT:
Return a single JSON object with the following fields:

- "step_title": (String) Clear, action-oriented title for this step (e.g., "Fill out contact form", "Navigate to settings page")
- "step_summary": (String) Brief summary of what the user accomplished in this step (1-2 sentences)
- "events_that_happened": (String) Specific user actions: clicks, keystrokes, navigation, scrolling, etc. Be precise about what occurred.
- "how_content_changed": (String) What changed on the screen as a result of the user's actions (new elements appeared, text changed, page loaded, etc.)
- "results_if_any": (String) Outcomes, confirmations, errors, notifications, or responses from the system
- "what_was_clicked": (String) Specific UI elements that were clicked (buttons, links, icons, etc.) - include exact labels/text if visible
- "what_was_typed": (String) Text input by the user, if any (actual text content or description of what was typed)
- "user_intent": (String) The user's likely goal or intention behind this action - what were they trying to accomplish?
"#;

/// Schema for label suggestion output
pub const LABEL_SUGGESTION_SCHEMA: &str = r#"{
    "type": "object",
    "properties": {
        "label": { "type": "string" }
    },
    "required": ["label"]
}"#;

/// Prompt for context-aware step labeling
/// Ported from CONTEXT_AWARE_STEP_LABEL_PROMPT
pub const CONTEXT_AWARE_STEP_LABEL_PROMPT: &str = r#"You are an expert analyst. Your task is to re-evaluate a single 'target' analysis step using the context of its neighboring steps to create a single, highly descriptive, and context-aware label.

The goal is to produce a label for the target step that is more meaningful than its original summary, by using the neighbors to understand its purpose.

For example, if the target step's summary is just "Clicked button 'Submit'", but the neighboring steps show the user filling out a registration form, the new label should be "Submitted the 'New User Registration' form".

CRITICAL INSTRUCTIONS:
- Analyze the 'targetAnalysis' and the 'neighborAnalyses'.
- Synthesize this information to understand the immediate goal of the user's action.
- Return a single JSON object with one key: "label".
- The value of "label" should be the new, context-aware descriptive string for the target step.

EXAMPLE:
- Target Analysis Summary: "User typed 'password123'"
- Neighbor Analysis: User previously typed 'john.doe@email.com'
- Your Output (JSON):
{
  "label": "Entered password for user 'john.doe@email.com'"
}
"#;

/// Schema for workflow synthesis output
pub const WORKFLOW_SYNTHESIS_SCHEMA: &str = r#"{
    "type": "object",
    "properties": {
        "workflows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "step_name": { "type": "string" },
                                "substeps": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "substep_name": { "type": "string" },
                                            "inputs": { "type": "array", "items": { "type": "string" } },
                                            "outputs": { "type": "array", "items": { "type": "string" } },
                                            "business_logic": { "type": "array", "items": { "type": "string" } }
                                        },
                                        "required": ["substep_name", "inputs", "outputs", "business_logic"]
                                    }
                                }
                            },
                            "required": ["step_name", "substeps"]
                        }
                    }
                },
                "required": ["title", "description", "steps"]
            }
        }
    },
    "required": ["workflows"]
}"#;

/// Prompt for workflow synthesis
/// Ported from WORKFLOW_SYNTHESIS_PROMPT
pub const WORKFLOW_SYNTHESIS_PROMPT: &str = r#"You are an expert business analyst and AI engineer. Your task is to analyze a timeline of user events and synthesize a set of structured, detailed, and logical business workflows.

Please adhere to the following rules:
1. **Analyze the Entire Context**: Review the high-level user context, complete timeline of events, and any additional user instructions to understand the user's goals and actions.
2. **Follow User Instructions**: Pay special attention to any additional user instructions or context provided, as these clarify intent and requirements.
3. **Strictly Adhere to the Schema**: Generate a JSON object that strictly follows the provided schema. The output must be a single JSON object containing a 'workflows' array.
4. **Synthesize Hierarchical Steps**: For each workflow, break it down into high-level 'steps'. Each step must be further broken down into granular 'substeps'.
5. **Detail Each Sub-step**: For every single sub-step, you must define its 'inputs' (what triggers it), 'outputs' (what results from it), and 'business_logic' (the rules governing it).
6. **Be Concise and Logical**: Ensure the generated text is clear, concise, and logically sound. The goal is to create a machine-readable and human-readable workflow definition.
7. **Do Not Hallucinate**: Base all synthesized information directly on the provided context and event data. Do not invent steps, inputs, or outputs that are not supported by the evidence.
"#;

/// TypeScript workflow template with comment placeholders
pub const WORKFLOW_TS_TEMPLATE: &str = r#"/**
 * {workflow_name}
 * {workflow_description}
 * Generated from recording session on {generation_date}
 *
 * RECORDED STEPS:
{step_comments}
 */

import {{ createWorkflow, z }} from "@mediar-ai/workflow";
{step_imports}

// =============================================================================
// INPUT SCHEMA
// =============================================================================
// Inputs detected from recording:
{input_comments}

const inputSchema = z.object({{
{input_fields}
}});

// =============================================================================
// WORKFLOW DEFINITION
// =============================================================================
export default createWorkflow({{
  name: "{workflow_id}",
  description: "{workflow_description}",
  version: "1.0.0",
  input: inputSchema,

  steps: [
{step_references}
  ],

  onError: async ({{ error, logger }}) => {{
    logger.error("Workflow failed");
    logger.error(`Error: ${{error.message}}`);
  }},
}});
"#;

/// Step file template
pub const STEP_TS_TEMPLATE: &str = r#"import {{ createStep }} from "@mediar-ai/workflow";

export const {step_id} = createStep({{
  id: "{step_id}",
  name: "{step_name}",

  execute: async ({{ input, context, logger, desktop }}) => {{
    // {step_description}
    //
    // SUBSTEPS:
{substep_comments}
    //
    // INPUTS:
{input_list}
    //
    // OUTPUTS:
{output_list}
    //
    // BUSINESS LOGIC:
{logic_list}

    logger.info("Executing step: {step_name}");

    // TODO: Implement step logic based on recorded actions
{step_todos}

    return {{ success: true }};
  }},
}});
"#;
