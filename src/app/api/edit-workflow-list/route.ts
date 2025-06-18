import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }
  return new GoogleGenerativeAI(apiKey);
}

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const workflowListSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflows: { 
            type: SchemaType.ARRAY, 
            items: { type: SchemaType.STRING },
            description: "Array of workflow names"
        },
    },
    required: ['workflows']
};

const WORKFLOW_LIST_EDIT_PROMPT = `You are an AI assistant helping a user edit a list of workflow names. The user will provide an instruction, and you will return the updated list of workflow names.

INSTRUCTIONS:
1. You will receive a user instruction and the current list of workflow names
2. Apply the requested changes (add, remove, rename, reorder workflows)
3. Return the complete updated list in the specified JSON format
4. If the instruction is unclear or cannot be applied, return the original list unchanged
5. Workflow names should be clear, descriptive, and professional

EXAMPLES:
- "Remove the email workflow" → Remove any workflow containing "email"
- "Change Customer Support to Help Desk" → Rename that specific workflow
- "Add Invoice Processing" → Add the new workflow to the list
- "Remove workflows 2 and 4" → Remove the 2nd and 4th workflows by position

Your response must be valid JSON only, no explanatory text.`;

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, instruction, current_workflows } = await req.json();

    if (!modelName || !instruction || !Array.isArray(current_workflows)) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: workflowListSchema,
      },
      safetySettings,
    });
    
    const prompt = `${WORKFLOW_LIST_EDIT_PROMPT}\n\nUser Instruction: "${instruction}"\n\nCurrent Workflows:\n${current_workflows.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const updatedList = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json(updatedList);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ workflows: current_workflows }, { status: 200 });

  } catch (error) {
    console.error('Error editing workflow list:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 