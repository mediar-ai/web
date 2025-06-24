import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part } from '@google/generative-ai';
import { ParsedAnalysis, LLMStructuredOutput } from '@/types';
import { legacyAnalysisSchema, getSchemaByVersion, SchemaVersion } from './llmSchemas';

type AnalysisContext = {
  previousUiTree?: string | null;
  previousWindowTitle?: string;
  previousWindowTimestamp?: string;
  currentUiTree?: string | null;
  eventsSincePreviousUiTreeByTimestamp?: string[];
  eventsSincePreviousUiTreeBySameWindow?: string[];
  uiTreeDiffLatestVsPreviousForTheSameWindow?: string;
  previousAnalyses?: Array<{
    created_at: string,
    step: string,
    description: string
  }>;
  screenshotBefore?: string;
  screenshotAfter?: string;
  screenshotBeforeSameWindow?: string;
};

// 1. Correctly instantiate the Supabase Admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);


// 2. Define constants and schemas from process-workflow-step route
const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  return new GoogleGenerativeAI(apiKey);
};


// 3. Create the reusable analysis function
export async function generateWorkflowStepAnalysis(prompt: string, modelName: string, context: AnalysisContext): Promise<ParsedAnalysis> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: legacyAnalysisSchema,
      },
      safetySettings,
    });

    const contextParts: Part[] = [];

    // This is the fully restored context construction logic.
    if (context.screenshotBefore) {
        const parts = context.screenshotBefore.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot Before (Previous UI Tree by Timestamp):" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.screenshotBeforeSameWindow) {
        const parts = context.screenshotBeforeSameWindow.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot Before (Previous UI Tree Same Window):" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.screenshotAfter) {
        const parts = context.screenshotAfter.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot After (Current UI Tree):" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.previousUiTree) {
        contextParts.push({ text: `\n\nUI Tree (Before):\n${context.previousUiTree}` });
    }
    if (context.previousWindowTitle) {
        contextParts.push({ text: `\n\nPrevious Window: ${context.previousWindowTitle}` });
        if (context.previousWindowTimestamp) {
            contextParts.push({ text: `Previous Window Timestamp: ${context.previousWindowTimestamp}` });
        }
    }
    if (context.currentUiTree) {
        contextParts.push({ text: `\n\nUI Tree (After):\n${context.currentUiTree}` });
    }
    if (context.uiTreeDiffLatestVsPreviousForTheSameWindow) {
        contextParts.push({ text: `\n\nUI Tree Diff (Same Window):\n${context.uiTreeDiffLatestVsPreviousForTheSameWindow}` });
    }
    if (context.eventsSincePreviousUiTreeByTimestamp && context.eventsSincePreviousUiTreeByTimestamp.length > 0) {
        const eventsText = context.eventsSincePreviousUiTreeByTimestamp.join('\n');
        contextParts.push({ text: `\n\nEvents (Since Previous UI Tree):\n${eventsText}` });
    }
    if (context.eventsSincePreviousUiTreeBySameWindow && context.eventsSincePreviousUiTreeBySameWindow.length > 0) {
        const eventsText = context.eventsSincePreviousUiTreeBySameWindow.join('\n');
        contextParts.push({ text: `\n\nEvents (Since Same Window UI Tree):\n${eventsText}` });
    }
    if (context.previousAnalyses && context.previousAnalyses.length > 0) {
        const analysesText = context.previousAnalyses.map((a: { created_at: string, step: string, description: string }) => `[${new Date(a.created_at).toISOString()}] ${a.step}: ${a.description}`).join('\n');
        contextParts.push({ text: `\n\nRecent Workflow Steps:\n${analysesText}` });
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }, ...contextParts] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const analysis = JSON.parse(response.candidates[0].content.parts[0].text);
        return analysis as ParsedAnalysis;
    }
    
    throw new Error('Failed to generate analysis from the model.');
}

// 4. Create the reusable save function with JSONB support
export async function saveWorkflowStepAnalysis(
    userId: string, 
    sessionId: string, 
    clientTimestamp: string, 
    analysis: ParsedAnalysis,
    modelName?: string
) {
    const normalizedTimestamp = new Date(clientTimestamp).toISOString();
    
    // Create structured output for JSONB storage directly, assuming V2+
    const structuredOutput: LLMStructuredOutput = {
        ...analysis,
        schema_version: 'v2', // Default to v2
        generation_timestamp: new Date().toISOString(),
        model_used: modelName,
    };

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

// 5. New function to save with custom structured output (for future schemas)
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

// 6. Enhanced analysis function with configurable schema
export async function generateWorkflowStepAnalysisWithSchema(
    prompt: string, 
    modelName: string, 
    context: AnalysisContext,
    schemaVersion: SchemaVersion = 'v1_legacy'
): Promise<LLMStructuredOutput> {
    const genAI = getGenAI();
    const schema = getSchemaByVersion(schemaVersion);
    
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
      safetySettings,
    });

    const contextParts: Part[] = [];

    // Context construction logic (same as original)
    if (context.screenshotBefore) {
        const parts = context.screenshotBefore.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot Before (Previous UI Tree by Timestamp):" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.screenshotBeforeSameWindow) {
        const parts = context.screenshotBeforeSameWindow.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot Before (Previous UI Tree Same Window):" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.screenshotAfter) {
        const parts = context.screenshotAfter.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot After (Current UI Tree):" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.previousUiTree) {
        contextParts.push({ text: `\n\nUI Tree (Before):\n${context.previousUiTree}` });
    }
    if (context.previousWindowTitle) {
        contextParts.push({ text: `\n\nPrevious Window: ${context.previousWindowTitle}` });
        if (context.previousWindowTimestamp) {
            contextParts.push({ text: `Previous Window Timestamp: ${context.previousWindowTimestamp}` });
        }
    }
    if (context.currentUiTree) {
        contextParts.push({ text: `\n\nUI Tree (After):\n${context.currentUiTree}` });
    }
    if (context.uiTreeDiffLatestVsPreviousForTheSameWindow) {
        contextParts.push({ text: `\n\nUI Tree Diff (Same Window):\n${context.uiTreeDiffLatestVsPreviousForTheSameWindow}` });
    }
    if (context.eventsSincePreviousUiTreeByTimestamp && context.eventsSincePreviousUiTreeByTimestamp.length > 0) {
        const eventsText = context.eventsSincePreviousUiTreeByTimestamp.join('\n');
        contextParts.push({ text: `\n\nEvents (Since Previous UI Tree):\n${eventsText}` });
    }
    if (context.eventsSincePreviousUiTreeBySameWindow && context.eventsSincePreviousUiTreeBySameWindow.length > 0) {
        const eventsText = context.eventsSincePreviousUiTreeBySameWindow.join('\n');
        contextParts.push({ text: `\n\nEvents (Since Same Window UI Tree):\n${eventsText}` });
    }
    if (context.previousAnalyses && context.previousAnalyses.length > 0) {
        const analysesText = context.previousAnalyses.map((a: { created_at: string, step: string, description: string }) => `[${new Date(a.created_at).toISOString()}] ${a.step}: ${a.description}`).join('\n');
        contextParts.push({ text: `\n\nRecent Workflow Steps:\n${analysesText}` });
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }, ...contextParts] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const analysis = JSON.parse(response.candidates[0].content.parts[0].text) as LLMStructuredOutput;
        
        // Add metadata
        analysis.schema_version = schemaVersion;
        analysis.model_used = modelName;
        analysis.generation_timestamp = new Date().toISOString();
        
        return analysis;
    }
    
    throw new Error('Failed to generate analysis from the model.');
} 