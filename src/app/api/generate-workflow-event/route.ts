import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT } from '@/lib/prompts';
import { v2AnalysisSchema } from '@/lib/llmSchemas';

const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  return new GoogleGenerativeAI(apiKey);
};

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: v2AnalysisSchema,
      },
      safetySettings,
    });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: WORKFLOW_STEP_ANALYSIS_V2_PROMPT }, { text: `\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}` }] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const analysisData = JSON.parse(response.candidates[0].content.parts[0].text);
        
        // Add schema version to mark as V2
        const v2Analysis = {
          ...analysisData,
          schema_version: 'v2'
        };
        
        return NextResponse.json(v2Analysis);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to generate workflow analysis from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error generating workflow event:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 