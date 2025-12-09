import { NextRequest, NextResponse } from 'next/server';
// import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google/genai';
import { WORKFLOW_EDIT_PROMPT } from '@/lib/prompts';

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

// Note: Vertex AI doesn't use the same schema format as Google AI Studio
// We'll handle JSON parsing manually instead
// const workflowSchema: Schema = {
//     type: SchemaType.OBJECT,
//     properties: {
//         title: { type: SchemaType.STRING },
//         inputs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
//         outputs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
//         steps: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
//         businessLogic: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
//     },
//     required: ['title', 'inputs', 'outputs', 'steps', 'businessLogic']
// };

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, instruction, current_workflow } = await req.json();

    if (!modelName || !instruction || !current_workflow) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 🔥 SWITCHED TO VERTEX AI 🔥
    console.log('🚀 Using Vertex AI for workflow editing with model:', modelName);
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
    });
    
    const prompt = `${WORKFLOW_EDIT_PROMPT}

User Instruction: "${instruction}"

Current Workflow:
${JSON.stringify(current_workflow, null, 2)}

Please respond with a JSON object in this exact format:
{
  "title": "workflow title",
  "inputs": ["input1", "input2"],
  "outputs": ["output1", "output2"],
  "steps": ["step1", "step2"],
  "businessLogic": ["logic1", "logic2"]
}`;

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
          const updatedWorkflow = JSON.parse(cleanedText);
          console.log('[SUCCESS] Vertex AI workflow edit successful');
        return NextResponse.json({ updatedWorkflow });
        } catch (parseError) {
          console.error('[ERROR] Failed to parse Vertex AI response as JSON:', parseError);
          console.log('🔍 Cleaned text:', cleanedText.substring(0, 300));
          return NextResponse.json({ 
            error: 'Invalid JSON response from Vertex AI',
            details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
            rawResponse: rawText.substring(0, 500)
          }, { status: 500 });
        }
    }
    
    console.error("No valid response from Vertex AI model:", response);
    return NextResponse.json({ error: 'Failed to edit workflow from the Vertex AI model.' }, { status: 500 });

  } catch (error) {
    console.error('Error editing workflow with Vertex AI:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 