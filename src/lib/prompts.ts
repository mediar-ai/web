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