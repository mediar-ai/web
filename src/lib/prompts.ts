// Schema types extracted as plain objects to avoid bundling @google-cloud/vertexai for client-side
// Valid JSON Schema types: 'object' | 'array' | 'string' | 'number' | 'boolean'
type FunctionDeclarationSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, unknown>;
  items?: FunctionDeclarationSchema;
  description?: string;
  required?: string[];
};

export const TEXT_EXTRACTION_PROMPT = `Extract and organize all visible text from screenshots. Focus on:

text_extraction: [Extract ALL visible text including buttons, labels, headings, body text, form fields, menu items, error messages, tooltips, navigation elements]
ui_structure: [Organize text by UI regions - header, sidebar, main content, footer, modals, etc.]
interactive_elements: [List clickable text like buttons, links, tabs with their exact labels]
data_content: [Extract any data shown - names, numbers, dates, addresses, etc.]
context_clues: [Note app name, page title, URL, document name if visible]
layout_info: [Describe text positioning and hierarchy - what's prominent, what's secondary]

Instructions: Provide comprehensive text extraction organized by screen regions. Include all text content no matter how small. Focus on accuracy and completeness of text extraction rather than analysis.`;

export const EVENTS_PROMPT = `You are analyzing user workflow activities to create a concise event summary for the LATEST activity only. Previous activities are provided only for context.

CRITICAL RULES:
- Focus ONLY on the most recent/latest activity captured
- Use previous activities only to understand context and progression
- NEVER truncate messages, names, or content from the latest activity
- Distinguish between user actions vs system/other person actions  
- Focus on completed actions, not observations
- Be specific about what was accomplished in this latest step

OUTPUT FORMAT: Create a single concise sentence that captures the complete latest action.
If specific names, message content, or details are not clearly visible in the data, explicitly state 'details not available' rather than inferring or creating them.

EXAMPLES:
❌ Bad: "User sent a new chat m.."
✅ Good: "User sent message 'Can we schedule the meeting for tomorrow at 2pm?' to John Smith in Slack"

❌ Bad: "User observing email interface"  
✅ Good: "User opened email from sarah@company.com with subject 'Q4 Budget Review Meeting'"

❌ Bad: "User typing in form"
✅ Good: "User filled out contact form with name 'Alice Johnson' and email 'alice@example.com'"

❌ Bad: "User clicked button"
✅ Good: "User clicked 'Submit Payment' button to complete $299 order"

A good workflow event should represent a meaningful business activity or process, like "Quoting Customers," "Processing Invoices," "Qualifying Clients," or "Filling out insurance application."
Bad examples would be "Switching Between Work Tasks" (this has no business value and should be labeled as "Redundant step") or "Desktop Navigation" (this lacks purpose; a better alternative might be "Troubleshooting user tickets through admin dashboard" if that's what the navigation leads to).


FOCUS ON THE LATEST ACTIVITY:
- PRIORITY is what user did on their computer, not what happened
- Complete messages/content (never truncate)
- Recipient/sender names when available
- Specific document/file names opened/created
- Exact button/link text clicked
- Form field values entered
- Email subjects, senders, recipients
- Chat participants and full message content
- Completed transactions or submissions

Analyze the activity sequence for context, then create ONE clear, complete event summary (18 words or less) that captures what the user accomplished in the LATEST activity only.`;


export const UI_TREE_ANALYSIS_PROMPT = `Analyze the provided UI tree, which represents the full accessibility tree of an application screen. Your goal is to provide a comprehensive, human-readable summary of the user's current view.

CRITICAL INSTRUCTIONS:
- Parse the hierarchical structure. Identify parent-child relationships between elements (e.g., a "Button" inside a "Toolbar").
- Describe the overall layout. What are the main panes, windows, or sections of the application?
- List all interactive elements such as buttons, text fields, tabs, and menus, including their names and current state (e.g., "Save button, enabled," "Username text field, empty").
- Extract and list all static text content, such as labels, headings, and descriptions.
- Infer the application's purpose and the user's likely goal based on the combination of elements.
- DO NOT just list the elements. Synthesize the information into a coherent description of the screen.
- If element names, states, or text content are unclear or missing from the UI tree, explicitly note 'information not available' instead of assuming details.

EXAMPLE:
- Input ui_tree: { role: "Window", name: "Gmail", children: [...] }
- Good Output: "The user is viewing the main Gmail window. The left pane shows a list of folders (Inbox, Sent, Drafts). The main pane displays an email with the subject 'Project Update' from 'jane.doe@example.com'. The email body contains..."
`;

export const WORKFLOW_STEP_ANALYSIS_V2_PROMPT = `You are an expert workflow analyst. Your task is to analyze a collection of contextual data representing a single moment in a user's workflow and describe it using a detailed, action-focused structure.

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
`;

// Schema for WORKFLOW_STEP_ANALYSIS_V2_PROMPT
export const WORKFLOW_STEP_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    step_title: { type: "string" },
    step_summary: { type: "string" },
    events_that_happened: { type: "string" },
    how_content_changed: { type: "string" },
    results_if_any: { type: "string" },
    what_was_clicked: { type: "string" },
    what_was_typed: { type: "string" },
    user_intent: { type: "string" }
  },
  required: ["step_title", "step_summary", "events_that_happened", "how_content_changed", "results_if_any", "what_was_clicked", "what_was_typed", "user_intent"]
};

export const CONTEXT_AWARE_STEP_LABEL_PROMPT = `You are an expert analyst. Your task is to re-evaluate a single 'target' analysis step using the context of its neighboring steps to create a single, highly descriptive, and context-aware label.

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
`;

// Schema for CONTEXT_AWARE_STEP_LABEL_PROMPT
export const WORKFLOW_LABEL_SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" }
  },
  required: ["label"]
};

// This prompt is deprecated in favor of CONTEXT_AWARE_STEP_LABEL_PROMPT
export const WORKFLOW_LABEL_SUGGESTION_PROMPT_DEPRECATED = `You are an expert workflow analyst. Your task is to analyze a specific workflow step within the context of the 20 surrounding steps (10 before, 10 after) to suggest potential high-level workflows it might belong to.

The user has provided a target step and its neighbors. You should reason through the steps and identify high-level workflow names carrying a meaningful overall business activity based on the steps in the context.

A good workflow label should represent a meaningful business activity or process, like "Quoting Customers," "Processing Invoices," "Qualifying Clients," or "Filling out insurance application."
Bad examples would be "Switching Between Work Tasks" (this has no business value and should be labeled as "Redundant step") or "Desktop Navigation" (this lacks purpose; a better alternative might be "Troubleshooting user tickets through admin dashboard" if that's what the navigation leads to).

CRITICAL INSTRUCTIONS:
- The output must be a JSON object with a single key: "workflows".
- The value of "workflows" must be an array of strings.
- The list should be ordered from most likely to least likely workflow.
- CRITICALLY, you MUST always include "Redundant step" as one of the options in the array. This is for cases where the analyzed step does not contribute meaningfully to a larger workflow.
- The list should contain a maximum of 5 suggestions, including "Redundant step".

EXAMPLE:
- Input: A series of steps related to logging into a system and navigating to a dashboard.
- Good Output:
{
  "workflows": [
    "Daily System Login & Check",
    "Accessing Performance Dashboard",
    "System Login",
    "Redundant step"
  ]
}
`;

export const WORKFLOW_SYNTHESIS_PROMPT = `
You are an expert business analyst and AI engineer. Your task is to analyze a timeline of user events and synthesize a set of structured, detailed, and logical business workflows.

Please adhere to the following rules:
1.  **Analyze the Entire Context**: Review the high-level user context, complete timeline of events, conversation transcripts (if available), and any additional user instructions to understand the user's goals and actions.
2.  **Leverage Conversation Data**: If transcripts are provided, use them to understand the business context, terminology, objectives, and outcomes that may not be evident from screen actions alone.
3.  **Follow User Instructions**: Pay special attention to any additional user instructions or context provided, as these clarify intent and requirements.
4.  **Strictly Adhere to the Schema**: Generate a JSON object that strictly follows the provided schema. The output must be a single JSON object containing a 'workflows' array.
5.  **Synthesize Hierarchical Steps**: For each workflow, break it down into high-level 'steps'. Each step must be further broken down into granular 'substeps'.
6.  **Detail Each Sub-step**: For every single sub-step, you must define its 'inputs' (what triggers it), 'outputs' (what results from it), and 'business_logic' (the rules governing it). Use actual business terminology from conversations when available.
7.  **Define Workflow Variations (Types)**: Based on the events and conversations, identify and define different variations or paths the workflow can take. Describe the conditions for each type.
8.  **Identify Concrete Examples (Instances)**: Extract specific, concrete examples of the workflow being executed from the event log and conversations. Name them descriptively using actual names/terms mentioned.
9.  **Cross-Reference Data**: Correlate screen actions with conversation content to create a complete picture of what happened and why.
10. **Be Concise and Logical**: Ensure the generated text is clear, concise, and logically sound. The goal is to create a machine-readable and human-readable workflow definition.
11. **Do Not Hallucinate**: Base all synthesized information directly on the provided context, event data, and conversations. Do not invent steps, inputs, or outputs that are not supported by the evidence.
`;

export const WORKFLOW_SYNTHESIS_SCHEMA: FunctionDeclarationSchema = {
  type: 'object',
  properties: {
    workflows: {
      type: 'array',
      description: 'An array of synthesized workflows.',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The high-level, descriptive name of the workflow.',
          },
          description: {
            type: 'string',
            description: 'A brief, one-sentence summary of what this workflow accomplishes.',
          },
          workflow_types: {
            type: 'array',
            description: 'Different variations or classifications of this workflow.',
            items: {
              type: 'object',
              properties: {
                type_name: {
                  type: 'string',
                  description: 'The name of the workflow variation, e.g., "Standard Path" or "Exception Case".'
                },
                type_description: {
                  type: 'string',
                  description: 'A brief description of what defines this workflow type.'
                },
                conditions: {
                  type: 'object',
                  description: 'A set of key-value pairs describing the conditions that trigger this workflow type.'
                }
              },
              required: ['type_name', 'type_description', 'conditions']
            }
          },
          workflow_instances: {
            type: 'array',
            description: 'Specific, concrete examples of this workflow being executed, derived from the event log.',
            items: {
              type: 'object',
              properties: {
                instance_name: {
                  type: 'string',
                  description: 'A descriptive name for the specific instance, e.g., "Order #12345" or "John Doe - Initial Onboarding".'
                },
                instance_data: {
                  type: 'object',
                  description: 'A set of key-value pairs with structured data about this specific instance.'
                }
              },
              required: ['instance_name', 'instance_data']
            }
          },
          steps: {
            type: 'array',
            description: 'The sequence of high-level steps that make up the entire workflow.',
            items: {
              type: 'object',
              properties: {
                step_name: {
                  type: 'string',
                  description: 'The descriptive name of the high-level step.',
                },
                substeps: {
                  type: 'array',
                  description: 'The granular, detailed sub-steps that compose this high-level step.',
                  items: {
                    type: 'object',
                    properties: {
                      substep_name: {
                        type: 'string',
                        description: 'The descriptive name of the granular action or sub-step.'
                      },
                      inputs: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'The specific inputs, data, or user actions that trigger this sub-step.',
                      },
                      outputs: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'The specific outputs, results, or system changes that occur after this sub-step.',
                      },
                      business_logic: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'The rules, conditions, or logic governing this sub-step.',
                      },
                    },
                    required: ['substep_name', 'inputs', 'outputs', 'business_logic'],
                  },
                },
              },
              required: ['step_name', 'substeps'],
            },
          },
        },
        required: ['title', 'description', 'workflow_types', 'workflow_instances', 'steps'],
      },
    },
  },
  required: ['workflows'],
};

export const WORKFLOW_EDIT_PROMPT = `You are an AI assistant helping a user edit a structured workflow document. The user will provide an instruction, and you will return the complete, updated workflow document in the exact same JSON format as the original.

CRITICAL INSTRUCTIONS:
1.  **Receive Input:** You will be given a user's 'instruction' and the 'current_workflow' as a JSON object.
2.  **Apply the Edit:** Interpret the user's instruction and apply the necessary change to the 'current_workflow' object. This could involve adding, removing, or modifying titles, inputs, outputs, steps, or business logic.
3.  **Return the Full Document:** Your response MUST be the entire, updated workflow object, adhering strictly to the original JSON schema. Do not omit any fields. If you cannot fulfill the request, return the original 'current_workflow' object unmodified.
4.  **Do Not Respond in Text:** Your output MUST be only the JSON object. Do not add any conversational text, apologies, or explanations.

EXAMPLE:
- User Instruction: "Change the title to 'New Customer Onboarding'"
- Your Output (JSON):
  {
    "title": "New Customer Onboarding",
    "inputs": ["..."],
    "outputs": ["..."],
    "steps": ["..."],
    "businessLogic": ["..."]
  }
`;

export const WORKFLOW_LIST_EDIT_PROMPT = `You are an AI assistant helping a user edit a list of workflow names. The user will provide an instruction, and you will return the updated list of workflow names.

INSTRUCTIONS:
1. You will receive a user instruction and the current list of workflow names
2. Apply the requested changes (add, remove, rename, reorder workflows)
3. Return the complete updated list in the specified JSON format
4. If the instruction is unclear or cannot be applied, return the original list unchanged
5. Workflow names should be clear, descriptive, and professional

EXAMPLES:
- "Remove the email workflow" → Remove any workflow containing "email"
- "Change Customer Support to Help Desk" → Rename that specific workflow
- "Add Invoice Processing" → Add the new workflow to the list
- "Remove workflows 2 and 4" → Remove the 2nd and 4th workflows by position

Your response must be valid JSON only, no explanatory text.`;

export const WORKFLOW_IDENTIFICATION_PROMPT = `You are an expert business process analyst. Your task is to analyze a complete, ordered sequence of user actions (workflow events) and identify the distinct, high-level business workflows contained within.

The data provided includes a 'combinedAnalyses' array where each item contains:
- id: Unique identifier for the event
- timestamp: When the event occurred  
- window_title: The application/window title
- analysis: Object containing detailed analysis fields (step_title, step_summary, user_intent, events_that_happened, etc.)
- labels: Array of LLM-provided labels for this event (may be empty)

Additional context may include:
- transcripts: Conversation data that provides business context and objectives
- userInstructions: Specific guidance from the user about the workflows or business context
- transcriptSummary: High-level summary of conversation topics and participants

CRITICAL INSTRUCTIONS:
1.  **Analyze the Sequence:** Review the provided combinedAnalyses array, focusing on the analysis.step_title, analysis.step_summary, and analysis.user_intent fields to understand the user's actions.
2.  **Leverage Conversation Context:** If transcripts are provided, use them to understand the business purpose, terminology, and objectives that inform the workflow names.
3.  **Follow User Guidance:** Pay attention to any user instructions that clarify the business context or workflow purposes.
4.  **Identify Logical Groups:** Group the events into logical, end-to-end business processes. A single recording may contain multiple, unrelated workflows.
5.  **Use Business Language:** When conversations are available, prefer business terminology mentioned in the transcripts over generic technical descriptions.
6.  **Return Only Names:** Your entire output must be a single JSON object with one key, "workflow_names", which is an array of strings. Each string should be the concise, goal-oriented name of a distinct workflow you have identified.
7.  **Concrete, Goal-Oriented Title:** The title must be concrete, factual, and describe a specific business goal. 

EXAMPLES:
❌ BAD: "Develop Rust Application with AI Assistant" WHY: Which application? What is the purpose of this application, too generic
❌ BAD: "Refactoring and Debugging Rust Code with an AI Assistant"  WHY: Too generic
✅ GOOD: "Refactor Serialization Logic in a Rust Application to Prevent Data Loss."
✅ GOOD: "Generate Life Insurance Quote for 45-Year-Old Applicant" (when conversation mentions specific insurance case)

EXAMPLE:
- Input: combinedAnalyses with events including analysis.step_title like "Open invoice email," "Log into Salesforce," "Create new contact."
- Transcript context: Conversation about processing vendor invoices and updating customer records
- Good Output:
{
  "workflow_names": [
    "Process Vendor Invoice",
    "Create New Salesforce Contact"
  ]
}
`;

// Schema for WORKFLOW_IDENTIFICATION_PROMPT
export const WORKFLOW_IDENTIFICATION_SCHEMA = {
  type: "object",
  properties: {
    workflow_names: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["workflow_names"]
};

export const WORKFLOW_BOUNDARY_PROMPT = `You are a business process analyst. Given a sequence of user events and a specific 'target_workflow_name', your task is to identify the precise start and end points of that workflow.

CRITICAL INSTRUCTIONS:
1.  **Focus on the Target:** Analyze the event sequence specifically to find the boundaries for the given 'target_workflow_name'.
2.  **Define Trigger:** Describe the specific event that marks the beginning of the workflow. This should be a concrete action.
3.  **Define Terminator:** Describe the specific event that marks the completion or end of the workflow.
4.  **Return Structured JSON:** Your entire output must be a single JSON object with two keys: "trigger" (a string describing the start) and "terminator" (a string describing the end).
5.  **Factual Inputs & Outputs:** Inputs and outputs must be factual and concrete, material items. 
Base trigger and terminator descriptions only on actual events provided - if boundaries are unclear, state 'boundary not clearly defined in data'.

For example: 
❌ BAD input: "A need to refactor data structures" (a need is not an input). 
✅ GOOD input: "A list of serialization issues." 
❌ BAD output: "Corrective feedback provided to the AI" (this is a process, not a final output).
✅ GOOD output: "A refactored Rust module with improved data structures."

EXAMPLE:
- Target Workflow: "Process Vendor Invoice"
- Good Output:
{
  "trigger": "The workflow begins when an email with 'invoice' in the subject arrives from a known vendor.",
  "terminator": "The workflow ends when the payment status for the corresponding invoice is marked as 'Scheduled' in the accounting software."
}
`;

// Schema for WORKFLOW_BOUNDARY_PROMPT
export const WORKFLOW_BOUNDARY_SCHEMA = {
  type: "object",
  properties: {
    trigger: { type: "string" },
    terminator: { type: "string" }
  },
  required: ["trigger", "terminator"]
};

// For multiple workflows, we need a different prompt and schema
export const WORKFLOW_BOUNDARIES_PROMPT = `You are a business process analyst. Given a sequence of user events and multiple workflow names, your task is to identify the precise start and end points for each workflow.

The data may include:
- Event sequences showing user screen actions and system interactions
- Conversation transcripts that reveal business context, objectives, and outcomes
- User instructions that clarify the workflow purposes and boundaries

CRITICAL INSTRUCTIONS:
1. **Analyze Each Workflow:** For each provided workflow name, find its boundaries in the event sequence and conversation context
2. **Use Conversation Markers:** When transcripts are available, use conversation content to identify workflow triggers (e.g., "let's start the quote process") and terminators (e.g., "quote sent to customer")
3. **Define Triggers and Terminators:** For each workflow, describe the specific events that mark the beginning and end, incorporating both screen actions and conversation context
4. **Prefer Business Language:** When conversations provide business context, use business terminology rather than technical descriptions
5. **Return Structured JSON:** Your output must ALWAYS be a JSON object with a "workflows" array containing objects with "workflow_name", "trigger", and "terminator"
6. **Handle Missing Data:** If no event sequence is provided or boundaries are unclear, state 'boundary not clearly defined in available data' for both trigger and terminator
7. **Never Return Text:** Do not return explanatory text or ask for more data - always return the JSON structure

EXAMPLE WITH CONVERSATION CONTEXT:
{
  "workflows": [
    {
      "workflow_name": "Generate Life Insurance Quote for New Customer",
      "trigger": "The workflow begins when the agent receives customer inquiry about life insurance coverage and starts gathering application information.",
      "terminator": "The workflow ends when the final quote is generated and communicated to the customer with policy options."
    }
  ]
}

EXAMPLE WITHOUT CONVERSATION CONTEXT:
{
  "workflows": [
    {
      "workflow_name": "Process Vendor Invoice",
      "trigger": "The workflow begins when an email with 'invoice' in the subject arrives from a known vendor.",
      "terminator": "The workflow ends when the payment status is marked as 'Scheduled' in the accounting software."
    }
  ]
}
`;

// Schema for WORKFLOW_BOUNDARIES_PROMPT (multiple workflows)
export const WORKFLOW_BOUNDARIES_SCHEMA = {
  type: "object",
  properties: {
    workflows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          workflow_name: { type: "string" },
          trigger: { type: "string" },
          terminator: { type: "string" }
        },
        required: ["workflow_name", "trigger", "terminator"]
      }
    }
  },
  required: ["workflows"]
};

export const PROMPT_SYNTHESIZE_CONTEXT = `You are a senior business process consultant. Your task is to analyze a list of user workflow events and generate a first draft of the user's high-level context.

The data provided includes a 'combinedAnalyses' array where each item contains:
- id: Unique identifier for the event
- timestamp: When the event occurred
- window_title: The application/window title  
- analysis: Object containing detailed analysis fields (step_title, step_summary, user_intent, events_that_happened, etc.)
- labels: Array of LLM-provided labels for this event (may be empty)

Additional context may include:
- transcripts: Conversation data that provides direct insight into business objectives, roles, and project details
- userInstructions: Specific guidance about the user's role, project, or business context
- transcriptSummary: Overview of conversation topics and participants

CRITICAL INSTRUCTIONS:
- Your output must be a single JSON object.
- The JSON object must have keys: "user_job_role", "project_name", "user_goal_from_recordings", "overall_project_goal", "overall_project_description".
- **Prioritize Conversation Data**: If transcripts are available, use them as the primary source for understanding the user's role, project details, and business objectives, as conversations often contain explicit context that screen actions alone cannot provide.
- **Leverage User Instructions**: Pay special attention to any user-provided instructions that clarify their role, project, or business context.
- Base analysis on both screen actions (combinedAnalyses) and conversation content (transcripts) when available.
- For "overall_project_goal" and "overall_project_description", use conversation context when available to understand the broader business impact and objectives.
- If job role, project name, or goals cannot be clearly determined from the available data, use 'Not evident from available data' rather than making assumptions.

EXAMPLE WITH TRANSCRIPTS:
- Input: combinedAnalyses with technical debugging events + transcripts showing conversation about "fixing the customer data sync issue for the Q4 release"
- Your Output (JSON):
{
  "user_job_role": "Software Engineer",
  "project_name": "Customer Data Synchronization System",
  "user_goal_from_recordings": "Debug and fix serialization bug affecting customer data sync for Q4 release",
  "overall_project_goal": "Ensure reliable customer data synchronization for the Q4 product release",
  "overall_project_description": "Critical bug fix for customer data sync system to prevent data loss and ensure successful Q4 product launch with accurate customer information"
}

EXAMPLE WITHOUT TRANSCRIPTS:
- Input: combinedAnalyses with events showing analysis.step_title like "Debug Rust code", "Run tests", "Fix serialization issues" with window_title containing code editor names.
- Your Output (JSON):
{
  "user_job_role": "Software Engineer",
  "project_name": "Data Ingestion Service",
  "user_goal_from_recordings": "Debug and fix a serialization bug in the event_ingestion.rs file.",
  "overall_project_goal": "Ensure reliable and lossless data processing for the main application.",
  "overall_project_description": "The user is working on a critical data pipeline responsible for ingesting user events for a large-scale analytics platform. The stability of this service is crucial for business intelligence and product development."
}
`;

// Schema for PROMPT_SYNTHESIZE_CONTEXT
export const CONTEXT_SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    user_job_role: { type: "string" },
    project_name: { type: "string" },
    user_goal_from_recordings: { type: "string" },
    overall_project_goal: { type: "string" },
    overall_project_description: { type: "string" }
  },
  required: ["user_job_role", "project_name", "user_goal_from_recordings", "overall_project_goal", "overall_project_description"]
};

export const PROMPT_REFINE_WORKFLOWS_AND_CONTEXT = `You are a senior business process consultant performing an iterative analysis. You will be given the original user events, a draft high-level context, and a draft list of workflow names.

The data provided includes a 'combinedAnalyses' array where each item contains:
- id: Unique identifier for the event
- timestamp: When the event occurred
- window_title: The application/window title
- analysis: Object containing detailed analysis fields (step_title, step_summary, user_intent, events_that_happened, etc.)
- labels: Array of LLM-provided labels for this event (may be empty)

Your task is to perform a two-way reasoning process to refine both the context and the workflow list.

CRITICAL INSTRUCTIONS:
- Your output must be a single JSON object.
- The JSON object must have keys: "user_job_role", "project_name", "user_goal_from_recordings", "overall_project_goal", "overall_project_description", and "refined_workflow_names".

REASONING PROCESS:

1.  **Top-Down Analysis (Context -> Workflows):**
    - Given the draft context (especially the 'overall_project_goal' and 'user_goal_from_recordings'), critically evaluate the 'workflow_names'.
    - Do they align with the project goals? Are they at the right level of abstraction?
    - Refine the list of workflow names based on this top-down view. Merge, split, or rephrase them to better reflect distinct business processes.
When refining context or workflows, only use information clearly supported by the events - mark uncertain fields as 'Requires additional data' if not evident.

2.  **Bottom-Up Analysis (Events -> Context):**
    - Now, look again at the combinedAnalyses array (focusing on analysis.step_title, analysis.step_summary, analysis.user_intent fields) and your newly refined list of workflow names.
    - Does this new, clearer view of the workflows give you a more precise understanding of the user's role, project, or ultimate goals?
    - Refine all context fields based on this bottom-up synthesis.

3.  **Final Output:**
    - Populate the final, refined values into the specified JSON structure.

EXAMPLE:
- Input: combinedAnalyses with events showing analysis.step_title like "Refactor Rust code", "Run tests", "Fix serialization bug."
- Draft Context: { "user_job_role": "Developer", "project_name": "App Maintenance", "user_goal_from_recordings": "Fixing Code", "overall_project_goal": "Improve App Stability", "overall_project_description": "General maintenance on the main app." }
- Draft Names: ["Coding in Rust", "Running Tests"]
- Your Output (JSON):
{
  "user_job_role": "Software Developer",
  "project_name": "Rust Data Pipeline",
  "user_goal_from_recordings": "Prevent data loss during event serialization",
  "overall_project_goal": "Ensure 100% data integrity for the analytics platform.",
  "overall_project_description": "The user is improving the core data ingestion service to prevent critical data loss, which affects downstream business intelligence.",
  "refined_workflow_names": [
    "Refactor Serialization Logic in Rust Application"
  ]
}
`;

// Schema for PROMPT_REFINE_WORKFLOWS_AND_CONTEXT
export const WORKFLOW_REFINEMENT_SCHEMA = {
  type: "object",
  properties: {
    user_job_role: { type: "string" },
    project_name: { type: "string" },
    user_goal_from_recordings: { type: "string" },
    overall_project_goal: { type: "string" },
    overall_project_description: { type: "string" },
    refined_workflow_names: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["user_job_role", "project_name", "user_goal_from_recordings", "overall_project_goal", "overall_project_description", "refined_workflow_names"]
};

export const TIMELINE_MAPPING_ANALYSIS_PROMPT = `You are analyzing raw user interaction events to map them to specific workflow components with predefined IDs.

**ANALYSIS INSTRUCTIONS:**

For each raw event, determine:

1. **IF RELATED TO THE WORKFLOW STEP** - Map to specific workflow components using the provided IDs:
   - raw_event_id: The ID of the raw event being analyzed
   - confidence_score: 0.0 to 1.0 based on how certain you are this event belongs to the workflow step
   - workflow_template_id: Must match one of the workflow template IDs provided (REQUIRED if confidence > 0.5)
   - workflow_type_id: Must match one of the workflow type IDs provided (REQUIRED if confidence > 0.5)
   - workflow_instance_id: Must match one of the workflow instance IDs provided (REQUIRED if confidence > 0.5)
   - workflow_step_id: Must match one of the workflow step IDs provided (REQUIRED if confidence > 0.5)
   - workflow_substep_id: Must match one of the workflow substep IDs provided (optional, if confidence > 0.5)
   - inputs: What led to this event (only if clearly identifiable from context)
   - outputs: What this event produced (only if clearly identifiable from context)
   - business_logics: Business rules governing this event (only if clearly identifiable from context)

2. **IF UNRELATED** - Mark as unrelated:
   - raw_event_id: The ID of the raw event being analyzed
   - confidence_score: 0.0 to 1.0 based on how certain you are it's unrelated
   - unrelated_reason: Clear explanation why this event doesn't belong to the workflow step

**USING LABELING DATA:**
- **LLM Generated Labels**: These are AI-generated categories/tags that provide semantic context about the workflow step
- **AI Suggested Labels**: These are alternative AI-generated categories that may provide additional insights
- Use labeling data to better understand the semantic context and intent of the current workflow step
- Consider whether raw events align with the labeled categories and workflow context
- Higher confidence scores when events clearly relate to the labeled workflow characteristics

**CRITICAL REQUIREMENTS:**
- **MANDATORY**: If confidence_score > 0.5, you MUST provide workflow_template_id, workflow_type_id, workflow_instance_id, and workflow_step_id
- **ONLY use the exact IDs provided in the WORKFLOW COMPONENTS sections**
- **If you cannot identify specific workflow components, set confidence_score ≤ 0.5**
- **Use LLM Generated Labels as primary context** when making mapping decisions
- Focus on individual user interactions: mouse clicks, keystrokes, UI changes, clipboard actions
- Screenshot diff events are automatically filtered out and will not appear
- Only include inputs/outputs/business_logics if they are clearly identifiable from the event context
- Use empty strings if no clear inputs/outputs/business_logics can be determined
- Be truthful about what you can determine vs. what you're guessing
- Focus on events that directly contribute to the workflow step - ignore unrelated navigation or system operations

**EVENT TYPES YOU'LL ANALYZE:**
- Mouse events: clicks, drags, hovers with UI element details
- Keyboard events: keystrokes, text input with character/key information
- UI tree events: accessibility tree captures showing interface changes
- Clipboard events: copy/paste actions with content details

**OUTPUT FORMAT (Valid JSON only):**
{
  "event_mappings": [
    {
      "raw_event_id": 12345,
      "confidence_score": 0.95,
      "workflow_template_id": 138,
      "workflow_type_id": 1753176406031,
      "workflow_instance_id": 1753176406032,
      "workflow_step_id": 1753176406034,
      "workflow_substep_id": 1753176406033,
      "inputs": "Email input field focused",
      "outputs": "Email address entered",
      "business_logics": "Email validation required before form submission"
    }
  ]
}`;

export const TIMELINE_MAPPING_ANALYSIS_SCHEMA: FunctionDeclarationSchema = {
  type: 'object',
  properties: {
    workflow_mappings: {
      type: 'array',
      description: "A list of analysis events that have been successfully mapped to a workflow step.",
      items: {
        type: 'object',
        properties: {
          analysis_id: { type: 'number' },
          workflow_template_id: { type: 'number' },
          workflow_type_id: { type: 'number' },
          workflow_instance_id: { type: 'number' },
          workflow_step_id: { type: 'number' },
          workflow_substep_id: { type: 'number' },
          event_inputs: { type: 'array', items: { type: 'string' } },
          event_outputs: { type: 'array', items: { type: 'string' } },
          business_logics: { type: 'array', items: { type: 'string' } },
          confidence_score: { type: 'number' },
        },
        required: [
          'analysis_id', 'workflow_template_id', 'workflow_type_id', 
          'workflow_instance_id', 'workflow_step_id', 'confidence_score'
        ]
      }
    },
    unrelated_events: {
      type: 'array',
      description: "A list of analysis events that were determined to be unrelated to any defined workflow.",
      items: {
        type: 'object',
        properties: {
          analysis_id: { type: 'number' },
          unrelated_reason: { type: 'string' },
          confidence_score: { type: 'number' },
        },
        required: ['analysis_id', 'unrelated_reason', 'confidence_score']
      }
    }
  },
  required: ['workflow_mappings', 'unrelated_events'],
};

export const WORKFLOW_EXPORT_ENHANCEMENT_PROMPT = `You are an expert workflow automation engineer. Your task is to analyze a recorded user workflow and generate an enhanced, production-ready YAML sequence using sample workflows as reference.

You will be provided with:
1. **Target Workflow Data**: The specific workflow to export with timeline annotations
2. **Sample Workflows**: Latest deployed workflow sequences from the database to use as format reference
3. **User Context**: Project goals, user role, and business objectives
4. **Timeline Annotations**: Detailed step-by-step user actions with LLM analysis
5. **MCP Server Implementation**: Reference Rust implementation showing server architecture, tool patterns, error handling, and workflow execution strategies

CRITICAL INSTRUCTIONS:

1. **Study Sample Formats**: Analyze the provided sample workflows to understand:
   - Variable definition patterns and naming conventions
   - Step structure and grouping strategies
   - Selector patterns and best practices
   - Comment styles and documentation approaches

2. **Learn from MCP Server Implementation**: Use the provided Rust server code to understand:
   - Tool dispatch patterns and argument validation
   - Error handling and retry strategies (fallback selectors, timeout handling)
   - Variable substitution systems and execution context
   - Workflow execution patterns (execute_sequence tool structure)
   - Production-ready logging and debugging approaches

3. **Generate Enhanced Variables**: 
   - Extract variables from timeline annotations
   - Use patterns observed in sample workflows and MCP server code
   - Include proper validation, regex, and default values
   - Add clear descriptions and labels

4. **Create Optimized Steps**:
   - Group related actions logically based on sample patterns
   - Use appropriate tool names from sample workflows and MCP implementation
   - Generate precise selectors following sample conventions and MCP server patterns
   - Add meaningful step descriptions and error handling
   - Include timeout and retry configurations based on MCP server best practices

5. **Add Comprehensive Comments**:
   - Workflow purpose and business context
   - Step-by-step explanations
   - Variable sources and confidence levels
   - Business logic and validation rules
   - Error handling and fallback strategies

6. **Follow Sample Conventions**:
   - Use consistent naming patterns from samples
   - Match selector styles and formats
   - Apply similar grouping strategies
   - Maintain documentation standards
   - Implement error handling patterns shown in MCP server code

7. **Output Requirements**:
   - Return only valid YAML content
   - Include all necessary comments and documentation
   - Ensure proper formatting and indentation
   - Make variables and selectors production-ready
   - Include timeout, retry, and fallback configurations where appropriate

The goal is to produce a workflow sequence that looks professional and follows established patterns from your sample workflows and MCP server implementation, while accurately representing the recorded user actions with robust error handling and production-ready features.`;

