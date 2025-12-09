import { createClient } from '@supabase/supabase-js';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { LLMStructuredOutput } from '@/types';
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT, WORKFLOW_STEP_ANALYSIS_SCHEMA } from './prompts';

type AnalysisContext = {
  previousUiTree?: string | null;
  previousWindowTitle?: string;
  previousWindowTimestamp?: string;
  currentUiTree?: string | null;
  eventsSincePreviousUiTreeByTimestamp?: string[];
  eventsSincePreviousUiTreeBySameWindow?: string[];
  uiTreeDiffLatestVsPreviousForTheSameWindow?: string;
  previousAnalyses?: Array<{
    step_title: string,
    step_summary: string,
    user_intent: string,
    what_was_clicked: string,
    what_was_typed: string,
    how_content_changed: string,
    events_that_happened: string,
    results_if_any: string,
    client_timestamp: string | null
  }>;
  screenshotBefore?: string;
  screenshotAfter?: string;
  screenshotBeforeSameWindow?: string;
};

// Supabase Admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper function to build context text for the LLM
function buildContextText(context: AnalysisContext): string {
  const contextParts: string[] = [];

  if (context.screenshotBefore) {
    contextParts.push("Screenshot Before (Previous UI Tree by Timestamp): [Image provided]");
  }
  if (context.screenshotBeforeSameWindow) {
    contextParts.push("Screenshot Before (Previous UI Tree Same Window): [Image provided]");
  }
  if (context.screenshotAfter) {
    contextParts.push("Screenshot After (Current UI Tree): [Image provided]");
  }
  if (context.previousUiTree) {
    contextParts.push(`\n\nUI Tree (Before):\n${context.previousUiTree}`);
  }
  if (context.previousWindowTitle) {
    contextParts.push(`\n\nPrevious Window: ${context.previousWindowTitle}`);
    if (context.previousWindowTimestamp) {
      contextParts.push(`Previous Window Timestamp: ${context.previousWindowTimestamp}`);
    }
  }
  if (context.currentUiTree) {
    contextParts.push(`\n\nUI Tree (After):\n${context.currentUiTree}`);
  }
  if (context.uiTreeDiffLatestVsPreviousForTheSameWindow) {
    contextParts.push(`\n\nUI Tree Diff (Same Window):\n${context.uiTreeDiffLatestVsPreviousForTheSameWindow}`);
  }
  if (context.eventsSincePreviousUiTreeByTimestamp && context.eventsSincePreviousUiTreeByTimestamp.length > 0) {
    const eventsText = context.eventsSincePreviousUiTreeByTimestamp.join('\n');
    contextParts.push(`\n\nEvents (Since Previous UI Tree):\n${eventsText}`);
  }
  if (context.eventsSincePreviousUiTreeBySameWindow && context.eventsSincePreviousUiTreeBySameWindow.length > 0) {
    const eventsText = context.eventsSincePreviousUiTreeBySameWindow.join('\n');
    contextParts.push(`\n\nEvents (Since Same Window UI Tree):\n${eventsText}`);
  }
  if (context.previousAnalyses && context.previousAnalyses.length > 0) {
    const analysesText = context.previousAnalyses.map((a) => `[${a.client_timestamp ? new Date(a.client_timestamp).toISOString() : 'No timestamp'}] ${a.step_title}: ${a.step_summary}`).join('\n');
    contextParts.push(`\n\nRecent Workflow Steps:\n${analysesText}`);
  }

  return contextParts.join('\n');
}

// 🔥 VERTEX AI WITH V2 SCHEMA ONLY 🔥
export async function generateWorkflowStepAnalysisWithSchema(
  prompt: string, 
  modelName: string, 
  context: AnalysisContext
): Promise<LLMStructuredOutput> {
  console.log('🚀 Using Vertex AI structured output for workflow analysis with model:', modelName);
  
  const contextText = buildContextText(context);
  const fullPrompt = `${WORKFLOW_STEP_ANALYSIS_V2_PROMPT}\n\nCONTEXT:\n${contextText}`;

  try {
    // Use V2 schema with structured output
    const result = await callVertexWithStructuredOutput(
      fullPrompt,
      {}, // Empty context since prompt already includes all needed data
      modelName,
      WORKFLOW_STEP_ANALYSIS_SCHEMA
    );

    // Add metadata
    const analysis: LLMStructuredOutput = {
      ...result,
      schema_version: 'v2_new',
      model_used: modelName,
      generation_timestamp: new Date().toISOString(),
    };

    console.log('[SUCCESS] Vertex AI workflow analysis successful');
    return analysis;
  } catch (error) {
    console.error('[ERROR] Vertex AI workflow analysis failed:', error);
    throw error;
  }
}

// Save function for V2 structured output
export async function saveWorkflowStepAnalysisWithCustomOutput(
  userId: string, 
  sessionId: string, 
  clientTimestamp: string, 
  structuredOutput: LLMStructuredOutput
) {
  const normalizedTimestamp = new Date(clientTimestamp).toISOString();

  const { data, error } = await supabaseAdmin
    .from('low_level_workflow_analyses')
    .insert([
      {
        user_id: userId,
        session_id: sessionId,
        client_timestamp: normalizedTimestamp,
        llm_structured_output: structuredOutput,
      },
    ]);

  if (error) {
    console.error('Error saving LLM analysis:', error);
    throw new Error(`Failed to save analysis to DB: ${error.message}`);
  }

  return data;
} 