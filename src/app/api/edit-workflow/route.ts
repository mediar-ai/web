import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_EDIT_PROMPT } from '@/lib/prompts';

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
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const workflowSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        title: { type: SchemaType.STRING },
        inputs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        outputs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        steps: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        businessLogic: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    },
    required: ['title', 'inputs', 'outputs', 'steps', 'businessLogic']
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, instruction, current_workflow } = await req.json();

    if (!modelName || !instruction || !current_workflow) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: workflowSchema,
      },
      safetySettings,
    });
    
    const prompt = `${WORKFLOW_EDIT_PROMPT}\n\nUser Instruction: "${instruction}"\n\nCurrent Workflow:\n${JSON.stringify(current_workflow, null, 2)}`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const updatedWorkflow = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json({ updatedWorkflow });
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to edit workflow from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error editing workflow:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 