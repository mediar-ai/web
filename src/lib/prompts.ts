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
1.  **Analyze the Entire Context**: Review the high-level user context and the complete timeline of events to understand the user's goals and actions.
2.  **Strictly Adhere to the Schema**: Generate a JSON object that strictly follows the provided schema. The output must be a single JSON object containing a 'workflows' array.
3.  **Synthesize Hierarchical Steps**: For each workflow, break it down into high-level 'steps'. Each step must be further broken down into granular 'substeps'.
4.  **Detail Each Sub-step**: For every single sub-step, you must define its 'inputs' (what triggers it), 'outputs' (what results from it), and 'business_logic' (the rules governing it).
5.  **Define Workflow Variations (Types)**: Based on the events, identify and define different variations or paths the workflow can take. Describe the conditions for each type.
6.  **Identify Concrete Examples (Instances)**: Extract specific, concrete examples of the workflow being executed from the event log. Name them descriptively.
7.  **Be Concise and Logical**: Ensure the generated text is clear, concise, and logically sound. The goal is to create a machine-readable and human-readable workflow definition.
8.  **Do Not Hallucinate**: Base all synthesized information directly on the provided context and event data. Do not invent steps, inputs, or outputs that are not supported by the evidence.
`;

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

export const WORKFLOW_IDENTIFICATION_PROMPT = `You are an expert business process analyst. Your task is to analyze a complete, ordered sequence of user actions (workflow events) and identify the distinct, high-level business workflows contained within.

CRITICAL INSTRUCTIONS:
1.  **Analyze the Sequence:** Review the provided list of event summaries.
2.  **Identify Logical Groups:** Group the events into logical, end-to-end business processes. A single recording may contain multiple, unrelated workflows.
3.  **Return Only Names:** Your entire output must be a single JSON object with one key, "workflow_names", which is an array of strings. Each string should be the concise, goal-oriented name of a distinct workflow you have identified.
4.  **Concrete, Goal-Oriented Title:** The title must be concrete, factual, and describe a specific business goal. 

EXAMPLES:
❌ BAD: "Develop Rust Application with AI Assistant" WHY: Which application? What is the purpose of this application, too generic
❌ BAD: "Refactoring and Debugging Rust Code with an AI Assistant"  WHY: Too generic
✅ GOOD: "Refactor Serialization Logic in a Rust Application to Prevent Data Loss."


EXAMPLE:
- Input: A list of events including "User opens invoice email," "User logs into Salesforce," "User creates new contact."
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

CRITICAL INSTRUCTIONS:
1. **Analyze Each Workflow:** For each provided workflow name, find its boundaries in the event sequence
2. **Define Triggers and Terminators:** For each workflow, describe the specific events that mark the beginning and end
3. **Return Structured JSON:** Your output must ALWAYS be a JSON object with a "workflows" array containing objects with "workflow_name", "trigger", and "terminator"
4. **Handle Missing Data:** If no event sequence is provided or boundaries are unclear, state 'boundary not clearly defined in data' for both trigger and terminator
5. **Never Return Text:** Do not return explanatory text or ask for more data - always return the JSON structure

EXAMPLE:
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

CRITICAL INSTRUCTIONS:
- Your output must be a single JSON object.
- The JSON object must have keys: "user_job_role", "project_name", "user_goal_from_recordings", "overall_project_goal", "overall_project_description".
- Base "user_job_role", "project_name", and "user_goal_from_recordings" *only* on the provided 'events'.
- For "overall_project_goal" and "overall_project_description", you must infer the high-level, long-term purpose. Think about the company, the larger project, and what the user is trying to achieve beyond the scope of the immediate recordings.
If job role, project name, or goals cannot be clearly determined from the events, use 'Not evident from recordings' rather than making assumptions.

EXAMPLE:
- Input Events: [Events showing coding in Rust, running tests, and debugging serialization issues for a data pipeline.]
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
    - Now, look again at the raw 'events' and your newly refined list of workflow names.
    - Does this new, clearer view of the workflows give you a more precise understanding of the user's role, project, or ultimate goals?
    - Refine all context fields based on this bottom-up synthesis.

3.  **Final Output:**
    - Populate the final, refined values into the specified JSON structure.

EXAMPLE:
- Input Events: [Events showing user refactoring Rust code to fix a serialization bug.]
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

export const TIMELINE_MAPPING_ANALYSIS_PROMPT = `You are analyzing timeline events to map them to confirmed workflows with detailed hierarchy.

**ANALYSIS INSTRUCTIONS:**

For each timeline event, determine:

1. **IF RELATED TO WORKFLOWS** - Map to confirmed workflows:
   - workflow_template_id: Must match one of the confirmed workflow IDs provided
   - workflow_type_name: Branch/path name (e.g., "Premium Customer Path", "Express Order", "Standard Process")
   - workflow_instance_name: Specific entity being processed (e.g., "Customer: John Doe", "Order: #12345", "Document: Contract_ABC.pdf")
   - workflow_step: Step name within the workflow
   - workflow_substep: Optional granular action within the step
   - event_inputs: Array of what led to this event (only include if clearly identifiable from context)
   - event_outputs: Array of what this event produced (only include if clearly identifiable from context)
   - business_logics: Array of business rules governing this event (only include if clearly identifiable from context)
   - confidence: 0.0 to 1.0 based on how certain you are about this mapping

2. **IF UNRELATED** - Mark as unrelated:
   - reason: Clear explanation why this doesn't belong to any business workflow
   - confidence: 0.0 to 1.0 based on how certain you are it's unrelated

**IMPORTANT GUIDELINES:**
- Only include inputs/outputs/business_logics if they are clearly identifiable from the event context
- Use empty arrays [] if no clear inputs/outputs/business_logics can be determined
- Be truthful about what you can determine vs. what you're guessing
- Look for entity identifiers (customer names, order numbers, document titles, user names) to create meaningful instances
- Infer workflow types based on patterns you observe (premium vs standard, express vs regular, different user paths, etc.)
- Focus on business-relevant events - ignore pure navigation, system operations, or personal activities
- If an event seems to span multiple workflows, create separate mappings for each

**OUTPUT FORMAT (Valid JSON only):**
{
  "timeline_mappings": [
    {
      "timeline_event_id": 12345,
      "mappings": [
        {
          "workflow_template_id": 101,
          "workflow_type_name": "Premium Customer Path",
          "workflow_instance_name": "Customer: John Doe",
          "workflow_step": "Verify Identity",
          "workflow_substep": "Check Government ID",
          "event_inputs": ["Government ID document uploaded"],
          "event_outputs": ["ID verification completed"],
          "business_logics": ["Must verify against government database"],
          "confidence": 0.95
        }
      ]
    },
    {
      "timeline_event_id": 12346,
      "unrelated": {
        "reason": "Personal web browsing unrelated to business workflows",
        "confidence": 0.88
      }
    }
  ],
  "analysis_metadata": {
    "total_events_analyzed": 2,
    "events_mapped": 1,
    "events_unrelated": 1
  }
}`;