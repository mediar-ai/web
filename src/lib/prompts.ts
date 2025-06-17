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
FOCUS ON THE LATEST ACTIVITY:
- Complete messages/content (never truncate)
- Recipient/sender names when available
- Specific document/file names opened/created
- Exact button/link text clicked
- Form field values entered
- Email subjects, senders, recipients
- Chat participants and full message content
- Completed transactions or submissions

Analyze the activity sequence for context, then create ONE clear, complete event summary that captures what the user accomplished in the LATEST activity only.`;

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