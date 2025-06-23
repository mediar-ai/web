import { Schema, SchemaType } from '@google/generative-ai';

// Legacy v1 schema (original 8 fields)
export const legacyAnalysisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflow: { 
            type: SchemaType.STRING, 
            description: "Best guess of the overall workflow/process name based on what you see." 
        },
        step: { 
            type: SchemaType.STRING, 
            description: "Concise name for this specific step, 3-5 words max." 
        },
        description: { 
            type: SchemaType.STRING, 
            description: "What is happening in 10 or less words." 
        },
        facts: { 
            type: SchemaType.STRING, 
            description: "Key observable facts from the screen." 
        },
        logic: { 
            type: SchemaType.STRING, 
            description: "Business rules or logic you can infer." 
        },
        tech: { 
            type: SchemaType.STRING, 
            description: "Technical details like application, browser, etc." 
        },
        apps: { 
            type: SchemaType.STRING, 
            description: "List of applications or programs visible." 
        },
        context: { 
            type: SchemaType.STRING, 
            description: "Specific context like browser tab titles, URLs, etc." 
        }
    },
    required: ['workflow', 'step', 'description', 'facts', 'logic', 'tech', 'apps', 'context']
};

// New v2 schema (proposed 8 fields)
export const v2AnalysisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        step_title: { 
            type: SchemaType.STRING, 
            description: "Clear, action-oriented title for this step (e.g., 'Fill out contact form')" 
        },
        step_summary: { 
            type: SchemaType.STRING, 
            description: "Brief summary of what the user accomplished in this step" 
        },
        events_that_happened: { 
            type: SchemaType.STRING, 
            description: "Specific user actions: clicks, keystrokes, navigation, etc." 
        },
        how_content_changed: { 
            type: SchemaType.STRING, 
            description: "What changed on the screen as a result of the user's actions" 
        },
        results_if_any: { 
            type: SchemaType.STRING, 
            description: "Outcomes, confirmations, errors, or responses from the system" 
        },
        what_was_clicked: { 
            type: SchemaType.STRING, 
            description: "Specific UI elements that were clicked (buttons, links, etc.)" 
        },
        what_was_typed: { 
            type: SchemaType.STRING, 
            description: "Text input by the user, if any" 
        },
        user_intent: { 
            type: SchemaType.STRING, 
            description: "The user's likely goal or intention behind this action" 
        }
    },
    required: ['step_title', 'step_summary', 'events_that_happened', 'how_content_changed', 'results_if_any', 'what_was_clicked', 'what_was_typed', 'user_intent']
};

// Hybrid schema that supports both formats for migration
export const hybridAnalysisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        // Legacy v1 fields
        workflow: { type: SchemaType.STRING, description: "Best guess of the overall workflow/process name." },
        step: { type: SchemaType.STRING, description: "Concise name for this specific step." },
        description: { type: SchemaType.STRING, description: "What is happening in 10 or less words." },
        facts: { type: SchemaType.STRING, description: "Key observable facts from the screen." },
        logic: { type: SchemaType.STRING, description: "Business rules or logic you can infer." },
        tech: { type: SchemaType.STRING, description: "Technical details like application, browser, etc." },
        apps: { type: SchemaType.STRING, description: "List of applications or programs visible." },
        context: { type: SchemaType.STRING, description: "Specific context like browser tab titles, URLs, etc." },
        
        // New v2 fields
        step_title: { type: SchemaType.STRING, description: "Clear, action-oriented title for this step." },
        step_summary: { type: SchemaType.STRING, description: "Brief summary of what the user accomplished." },
        events_that_happened: { type: SchemaType.STRING, description: "Specific user actions: clicks, keystrokes, navigation." },
        how_content_changed: { type: SchemaType.STRING, description: "What changed on the screen as a result." },
        results_if_any: { type: SchemaType.STRING, description: "Outcomes, confirmations, errors, or responses." },
        what_was_clicked: { type: SchemaType.STRING, description: "Specific UI elements that were clicked." },
        what_was_typed: { type: SchemaType.STRING, description: "Text input by the user, if any." },
        user_intent: { type: SchemaType.STRING, description: "The user's likely goal or intention." },
        
        // Metadata
        schema_version: { type: SchemaType.STRING, description: "Version of the schema used ('v1_legacy' or 'v2_new')" }
    },
    required: ['schema_version']
};

export type SchemaVersion = 'v1_legacy' | 'v2_new' | 'hybrid';

export function getSchemaByVersion(version: SchemaVersion): Schema {
    switch (version) {
        case 'v1_legacy':
            return legacyAnalysisSchema;
        case 'v2_new':
            return v2AnalysisSchema;
        case 'hybrid':
            return hybridAnalysisSchema;
        default:
            return legacyAnalysisSchema;
    }
} 