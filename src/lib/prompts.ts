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

EXAMPLE:
- Input ui_tree: { role: "Window", name: "Gmail", children: [...] }
- Good Output: "The user is viewing the main Gmail window. The left pane shows a list of folders (Inbox, Sent, Drafts). The main pane displays an email with the subject 'Project Update' from 'jane.doe@example.com'. The email body contains..."
`;

export const WORKFLOW_STEP_ANALYSIS_PROMPT = `You are an expert workflow analyst. Your task is to analyze a collection of contextual data representing a single moment in a user's workflow and describe it as a structured workflow step.

The user has provided the following context, based on their screen, UI structure, and recent events:
- Screenshots (before and after an action)
- UI Trees (the accessibility tree before and after an action)
- A stream of low-level events (mouse clicks, keystrokes, etc.)
- The three most recent workflow steps that were previously analyzed.

Based on this context, your goal is to determine the single, primary action the user took and describe it in a structured format.

OUTPUT FORMAT:
Return a single JSON object with the following fields.

- "workflow": (String) The name of the overall multi-step process the user is engaged in. Be specific (e.g., "Onboarding new client in Salesforce," not "Using CRM").
- "step": (String) A concise, verb-first name for this specific action, 3-5 words max (e.g., "Find client record," "Update contact details").
- "description": (String) A human-readable sentence describing what the user is doing in this step.
- "facts": (String) Key, observable facts from the screen that support your analysis (e.g., "User is on the 'Contacts' page, in the 'Edit Contact' modal.").
- "logic": (String) Any business rules or logic you can infer from the user's action (e.g., "A contact must have an email address to be saved.").
- "tech": (String) The applications, tools, or websites being used (e.g., "Salesforce, Google Chrome").
- "apps": (String) A simple, comma-separated list of visible application names.
- "context": (String) Specific environmental details, such as browser tab titles or URLs.
`;

export const WORKFLOW_LABEL_SUGGESTION_PROMPT = `You are an expert workflow analyst. Your task is to analyze a specific workflow step within the context of the 20 surrounding steps (10 before, 10 after) to suggest potential high-level workflows it might belong to.

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

export const WORKFLOW_SYNTHESIS_PROMPT = `You are an expert business process analyst. Your task is to analyze a complete, ordered sequence of user actions (workflow events) and synthesize them into one or more distinct, high-level business workflows.

The user has provided a JSON object containing a list of 'events'. Each event has a detailed 'analysis' from a previous step and a 'generated_output' which is a human-readable summary of the action.

CRITICAL INSTRUCTIONS:
1.  **Identify Distinct Workflows:** The sequence may contain multiple unrelated workflows. Group the events into logical, end-to-end business processes. A workflow should have a clear start and end and accomplish a specific business objective.
2.  **Synthesize, Don't Just List:** Your goal is to abstract the events into a coherent summary.
3.  **Factual Inputs & Outputs:** Inputs and outputs must be factual and concrete, material items. For example, a bad input is "A need to refactor data structures" (a need is not an input). A good input is "A list of serialization issues." A bad output is "Corrective feedback provided to the AI" (this is a process, not a final output). A good output is "A refactored Rust module with improved data structures."
4.  **Action-Oriented Steps:** The steps should read like a list of instructions or a description of the process from start to finish.
5.  **Identify Business Logic:** Explicitly list any constraints or conditions identified from the user's actions (e.g., 'All leads must have a valid phone number to be qualified').
6.  **Concrete, Goal-Oriented Title:** The title must be concrete, factual, and describe a specific business goal. For example, a bad title is "Refactoring and Debugging Rust Code with an AI Assistant" (too generic). A good title would be "Refactor Serialization Logic in a Rust Application to Prevent Data Loss."

OUTPUT FORMAT:
Return a single JSON object with a single key, "workflows". The value should be an array of workflow objects. Each object must have the following structure:
- "title": (String) A concise, descriptive title for the business workflow.
- "inputs": (Array of Strings) A list of items required to start the workflow.
- "outputs": (Array of Strings) A list of the final results or outcomes of the workflow.
- "steps": (Array of Strings) An ordered list of the human-readable event summaries ('generated_output') that constitute this workflow.
- "businessLogic": (Array of Strings) A list of inferred business rules, constraints, or conditions.
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

export const WORKFLOW_BOUNDARY_PROMPT = `You are a business process analyst. Given a sequence of user events and a specific 'target_workflow_name', your task is to identify the precise start and end points of that workflow.

CRITICAL INSTRUCTIONS:
1.  **Focus on the Target:** Analyze the event sequence specifically to find the boundaries for the given 'target_workflow_name'.
2.  **Define Trigger:** Describe the specific event that marks the beginning of the workflow. This should be a concrete action.
3.  **Define Terminator:** Describe the specific event that marks the completion or end of the workflow.
4.  **Return Structured JSON:** Your entire output must be a single JSON object with two keys: "trigger" (a string describing the start) and "terminator" (a string describing the end).
5.  **Factual Inputs & Outputs:** Inputs and outputs must be factual and concrete, material items. 

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

export const PROMPT_SYNTHESIZE_CONTEXT = `You are a senior business process consultant. Your task is to analyze a list of user workflow events and generate a first draft of the user's high-level context.

CRITICAL INSTRUCTIONS:
- Your output must be a single JSON object.
- The JSON object must have keys: "user_job_role", "project_name", "project_goal".
- Base your analysis *only* on the provided 'events'.

EXAMPLE:
- Input Events: [Events showing coding in Rust, running tests, and debugging serialization issues.]
- Your Output (JSON):
{
  "user_job_role": "Software Developer",
  "project_name": "Application Development",
  "project_goal": "Build and test a new feature"
}
`;

export const PROMPT_REFINE_WORKFLOWS_AND_CONTEXT = `You are a senior business process consultant performing an iterative analysis. You will be given the original user events, a draft high-level context, and a draft list of workflow names.

Your task is to perform a two-way reasoning process to refine both the context and the workflow list.

CRITICAL INSTRUCTIONS:
- Your output must be a single JSON object.
- The JSON object must have keys: "user_job_role", "project_name", "project_goal", and "refined_workflow_names".

REASONING PROCESS:

1.  **Top-Down Analysis (Context -> Workflows):**
    - Given the draft context ('user_job_role', 'project_name', 'project_goal'), critically evaluate the 'workflow_names'.
    - Do they align with the project goal? Are they at the right level of abstraction?
    - Refine the list of workflow names based on this top-down view. Merge, split, or rephrase them to better reflect distinct business processes.

2.  **Bottom-Up Analysis (Events -> Context):**
    - Now, look again at the raw 'events' and your newly refined list of workflow names.
    - Does this new, clearer view of the workflows give you a more precise understanding of the user's role, project, or ultimate goal?
    - Refine the 'user_job_role', 'project_name', and 'project_goal' based on this bottom-up synthesis.

3.  **Final Output:**
    - Populate the final, refined values into the specified JSON structure.

EXAMPLE:
- Input Events: [Events showing user refactoring Rust code to fix a serialization bug.]
- Draft Context: { "user_job_role": "Developer", "project_name": "App Maintenance", "project_goal": "Fixing Code" }
- Draft Names: ["Coding in Rust", "Running Tests"]
- Your Output (JSON):
{
  "user_job_role": "Software Developer",
  "project_name": "Rust Application Refactor",
  "project_goal": "Prevent data loss during serialization",
  "refined_workflow_names": [
    "Refactor Serialization Logic in Rust Application"
  ]
}
`; 