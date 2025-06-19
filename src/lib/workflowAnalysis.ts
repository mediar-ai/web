import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';
import { ParsedAnalysis } from '@/types';

type AnalysisContext = {
  previousUiTree?: string | null;
  currentUiTree?: string | null;
  eventsSincePreviousUiTreeByTimestamp?: string[];
  previousAnalyses?: Array<{
    created_at: string,
    step: string,
    description: string
  }>;
  screenshotBefore?: string;
  screenshotAfter?: string;
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

const mainAnalysisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflow: { type: SchemaType.STRING, description: "Best guess of the overall workflow/process name based on what you see." },
        step: { type: SchemaType.STRING, description: "Concise name for this specific step, 3-5 words max." },
        description: { type: SchemaType.STRING, description: "What is happening in 10 or less words." },
        facts: { type: SchemaType.STRING, description: "Key observable facts from the screen." },
        logic: { type: SchemaType.STRING, description: "Business rules or logic you can infer." },
        tech: { type: SchemaType.STRING, description: "Technical details like application, browser, etc." },
        apps: { type: SchemaType.STRING, description: "List of applications or programs visible." },
        context: { type: SchemaType.STRING, description: "Specific context like browser tab titles, URLs, etc." }
    },
    required: ['workflow', 'step', 'description', 'facts', 'logic', 'tech', 'apps', 'context']
};

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
        responseSchema: mainAnalysisSchema,
      },
      safetySettings,
    });

    const contextParts: Part[] = [];

    // This context construction logic is copied directly from the original route
    if (context.screenshotBefore) {
        const parts = context.screenshotBefore.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot Before:" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.screenshotAfter) {
        const parts = context.screenshotAfter.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot After:" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
     if (context.previousUiTree) {
        contextParts.push({ text: `\n\nUI Tree (Before):\n${context.previousUiTree}` });
    }
    if (context.currentUiTree) {
        contextParts.push({ text: `\n\nUI Tree (After):\n${context.currentUiTree}` });
    }
    if (context.eventsSincePreviousUiTreeByTimestamp && context.eventsSincePreviousUiTreeByTimestamp.length > 0) {
        const eventsText = context.eventsSincePreviousUiTreeByTimestamp.join('\n');
        contextParts.push({ text: `\n\nEvents:\n${eventsText}` });
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

// 4. Create the reusable save function
export async function saveWorkflowStepAnalysis(userId: string, sessionId: string, clientTimestamp: string, analysis: ParsedAnalysis) {
    const normalizedTimestamp = new Date(clientTimestamp).toISOString();

    const { data, error } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .insert([
        {
          user_id: userId,
          session_id: sessionId,
          client_timestamp: normalizedTimestamp,
          ...analysis,
        },
      ]);

    if (error) {
      console.error('Error saving LLM analysis:', error);
      throw new Error(`Failed to save analysis to DB: ${error.message}`);
    }

    return data;
} 