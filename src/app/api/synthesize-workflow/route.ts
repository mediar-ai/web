import { NextRequest, NextResponse } from 'next/server';
// import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { WORKFLOW_SYNTHESIS_PROMPT } from '@/lib/prompts';

interface WorkflowSynthesisInput {
  name: string;
  trigger?: string;
  terminator?: string;
  events: unknown[]; // Events can have varying structures
}

interface WorkflowContext {
  // Single workflow (legacy)
  workflow_name?: string;
  trigger?: string;
  terminator?: string;
  events?: unknown[];
  
  // Multiple workflows
  workflows?: WorkflowSynthesisInput[];
  workflowContext?: unknown; // Added to accept the new context
}

// const getGenAI = () => {
//   const apiKey = process.env.GEMINI_API_KEY;
//   if (!apiKey) {
//     throw new Error('GEMINI_API_KEY is not set.');
//   }
//   return new GoogleGenerativeAI(apiKey);
// };

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context }: { model: string; context: WorkflowContext } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters: model and context' }, { status: 400 });
    }

    // Function to process V1/V2 events to consistent format
    const processEvents = (events: unknown[]) => {
      return events.map((event: unknown) => {
        // Type guard to check if event has the expected structure
        if (typeof event === 'object' && event !== null && 'analysis' in event) {
          const typedEvent = event as { analysis?: { raw_llm_output?: { schema_version?: string; step_title?: string; step_summary?: string; user_intent?: string; events_that_happened?: string; how_content_changed?: string; what_was_clicked?: string; what_was_typed?: string; results_if_any?: string; } }; [key: string]: unknown; };
        
          if (typedEvent.analysis) {
            // Check if analysis has V2 structure (llm_structured_output)
            const analysis = typedEvent.analysis;
            if (analysis.raw_llm_output && analysis.raw_llm_output.schema_version === 'v2') {
              // Use V2 fields for workflow analysis
              return {
                ...typedEvent,
                analysis: {
                  workflow: analysis.raw_llm_output.step_title || 'Unknown Workflow',
                  step: analysis.raw_llm_output.step_summary || 'Unknown Step',
                  description: analysis.raw_llm_output.user_intent || 'No description',
                  actions: analysis.raw_llm_output.events_that_happened || 'No actions',
                  changes: analysis.raw_llm_output.how_content_changed || 'No changes',
                  clicked: analysis.raw_llm_output.what_was_clicked || 'Nothing clicked',
                  typed: analysis.raw_llm_output.what_was_typed || 'Nothing typed',
                  results: analysis.raw_llm_output.results_if_any || 'No results'
                }
              };
            } else {
              // Keep V1 structure as-is for backward compatibility
              return typedEvent;
            }
          }
        }
        return event;
      });
    };

    // Handle both single workflow (legacy) and multiple workflows
    const isMultipleWorkflows = context.workflows && Array.isArray(context.workflows);
    
    if (!isMultipleWorkflows && (!context.events || !context.workflow_name)) {
      return NextResponse.json({ error: 'Missing required parameters for single workflow: events and workflow_name' }, { status: 400 });
    }

    if (isMultipleWorkflows && (!context.workflows || !context.workflows.length)) {
      return NextResponse.json({ error: 'No workflows provided for synthesis' }, { status: 400 });
    }

    // 🔥 SWITCHED TO VERTEX AI 🔥
    console.log('🚀 Using Vertex AI for workflow synthesis with model:', modelName);
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
    });
    
    let prompt: string;
    
    if (isMultipleWorkflows && context.workflows) {
      // Multiple workflows synthesis
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const workflowDetails = context.workflows!.map((workflow: WorkflowSynthesisInput) => {
        const processedWorkflowEvents = processEvents(workflow.events);
        return `WORKFLOW: ${workflow.name}
TRIGGER: ${workflow.trigger || 'Not specified'}
TERMINATOR: ${workflow.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(processedWorkflowEvents, null, 2)}`;
      }).join('\n\n---\n\n');
      
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const workflowNames = context.workflows!.map((w: WorkflowSynthesisInput) => w.name).join(', ');
      
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize workflows for EXACTLY these workflow names (do not change or create new names): ${workflowNames}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

${workflowDetails}`;
    } else {
      // Single workflow synthesis (legacy support)
      const processedSingleEvents = context.events ? processEvents(context.events) : [];
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize a workflow with EXACTLY this name (do not change it): ${context.workflow_name}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

WORKFLOW: ${context.workflow_name}
TRIGGER: ${context.trigger || 'Not specified'}
TERMINATOR: ${context.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(processedSingleEvents, null, 2)}`;
    }
    
    const result = await model.generateContent(prompt);

    // 🔥 VERTEX AI RESPONSE HANDLING 🔥
    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const rawText = response.candidates[0].content.parts[0].text;
        console.log('📄 Raw Vertex AI response:', rawText.substring(0, 200) + '...');
        
        // Handle markdown-formatted JSON (remove ```json and ``` markers)
        let cleanedText = rawText.trim();
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        try {
          const synthesis = JSON.parse(cleanedText);
          console.log('✅ Vertex AI synthesis successful');
          return NextResponse.json(synthesis);
        } catch (parseError) {
          console.error('❌ Failed to parse Vertex AI response as JSON:', parseError);
          console.log('🔍 Cleaned text:', cleanedText.substring(0, 300));
          return NextResponse.json({ 
            error: 'Invalid JSON response from Vertex AI',
            details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
            rawResponse: rawText.substring(0, 500)
          }, { status: 500 });
        }
    }
    
    console.error("No valid response from Vertex AI model:", response);
    return NextResponse.json({ error: 'Failed to generate workflow synthesis from the Vertex AI model.' }, { status: 500 });

  } catch (error) {
    console.error('Error synthesizing workflow with Vertex AI:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 