import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_BOUNDARY_PROMPT } from '@/lib/prompts';
import { FlattenedWorkflowAnalysis } from '@/types';

// Removed unused interface - boundaries are handled as Record<string, {trigger: string, terminator: string}>

const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  return new GoogleGenerativeAI(apiKey);
};

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    // ... (safety settings are standard) ...
];

// Define a proper schema with array structure instead of dynamic keys
const boundarySchema: Schema = {
    type: SchemaType.OBJECT,
    description: "Boundaries for multiple workflows",
    properties: {
        workflows: {
            type: SchemaType.ARRAY,
            description: "Array of workflow boundary definitions",
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    workflow_name: {
                        type: SchemaType.STRING,
                        description: "The name of the workflow"
                    },
                    trigger: {
                        type: SchemaType.STRING,
                        description: "The trigger condition that starts this workflow"
                    },
                    terminator: {
                        type: SchemaType.STRING,
                        description: "The condition that ends this workflow"
                    }
                },
                required: ["workflow_name", "trigger", "terminator"]
            }
        }
    },
    required: ["workflows"]
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context || !context.analyses || !context.workflows) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Convert analyses to a consistent format for the LLM
    const processedAnalyses = context.analyses.map((analysis: FlattenedWorkflowAnalysis) => {
      // Check if analysis has V2 structure (llm_structured_output)
      if (analysis.raw_llm_output && analysis.raw_llm_output.schema_version === 'v2') {
        // Use V2 fields for workflow analysis
        return {
          id: analysis.id,
          timestamp: analysis.client_timestamp,
          workflow: analysis.raw_llm_output.step_title || 'Unknown Workflow',
          step: analysis.raw_llm_output.step_summary || 'Unknown Step',
          description: analysis.raw_llm_output.user_intent || 'No description',
          actions: analysis.raw_llm_output.events_that_happened || 'No actions',
          changes: analysis.raw_llm_output.how_content_changed || 'No changes',
          clicked: analysis.raw_llm_output.what_was_clicked || 'Nothing clicked',
          typed: analysis.raw_llm_output.what_was_typed || 'Nothing typed',
          results: analysis.raw_llm_output.results_if_any || 'No results'
        };
      } else {
        // Keep V1 structure as-is for backward compatibility
        return {
          id: analysis.id,
          timestamp: analysis.client_timestamp,
          workflow: analysis.workflow || 'Unknown Workflow',
          step: analysis.step || 'Unknown Step',
          description: analysis.description || 'No description',
          facts: analysis.facts || 'No facts',
          logic: analysis.logic || 'No logic',
          tech: analysis.tech || 'No tech',
          apps: analysis.apps || 'No apps',
          context: analysis.context || 'No context'
        };
      }
    });

    // Handle both single workflow (legacy) and multiple workflows
    const workflowNames = context.workflows.map((w: { workflow_name: string }) => w.workflow_name);
    
    if (!workflowNames || workflowNames.length === 0) {
      return NextResponse.json({ error: 'No workflow names provided' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: boundarySchema,
      },
      safetySettings,
    });
    
    const workflowList = workflowNames.map((name: string) => `- "${name}"`).join('\n');
    
    const prompt = `${WORKFLOW_BOUNDARY_PROMPT}

IMPORTANT: You must define boundaries for EXACTLY these workflow names (do not change or create new names):
${workflowList}

User's High-Level Context:
${JSON.stringify(context.userContext, null, 2)}

Analyses Context:
${JSON.stringify(processedAnalyses, null, 2)}

Labels Context:
${JSON.stringify(context.labels, null, 2)}`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const rawResponse = JSON.parse(response.candidates[0].content.parts[0].text);
        
        // Convert array format to object format expected by the frontend
        const boundaries: Record<string, {trigger: string, terminator: string}> = {};
        
        if (rawResponse.workflows && Array.isArray(rawResponse.workflows)) {
            rawResponse.workflows.forEach((workflow: {workflow_name?: string, trigger?: string, terminator?: string}) => {
                if (workflow.workflow_name && workflow.trigger && workflow.terminator) {
                    boundaries[workflow.workflow_name] = {
                        trigger: workflow.trigger,
                        terminator: workflow.terminator
                    };
                }
            });
        }
        
        // Return the boundaries in the expected object format
        return NextResponse.json(boundaries);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to define boundaries from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error defining boundaries:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 