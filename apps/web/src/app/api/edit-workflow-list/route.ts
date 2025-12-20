import { NextRequest, NextResponse } from 'next/server';
// import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google/genai';
import { WORKFLOW_LIST_EDIT_PROMPT } from '@/lib/prompts';
import { trackLLMUsageAsync } from '@/lib/llm-tracking';

// function getGenAI() {
//   const apiKey = process.env.GEMINI_API_KEY;
//   if (!apiKey) {
//     throw new Error('GEMINI_API_KEY is not set in environment variables');
//   }
//   return new GoogleGenerativeAI(apiKey);
// }

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// Note: Vertex AI doesn't use the same schema format as Google AI Studio
// We'll handle JSON parsing manually instead
// const workflowListSchema: Schema = {
//     type: SchemaType.OBJECT,
//     properties: {
//         workflows: { 
//             type: SchemaType.ARRAY, 
//             items: { type: SchemaType.STRING },
//             description: "Array of workflow names"
//         },
//     },
//     required: ['workflows']
// };

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, instruction, current_workflows } = await req.json();

    if (!modelName || !instruction || !Array.isArray(current_workflows)) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 🔥 SWITCHED TO VERTEX AI 🔥
    console.log('🚀 Using Vertex AI for workflow list editing with model:', modelName);
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
    });
    
    const prompt = `${WORKFLOW_LIST_EDIT_PROMPT}

User Instruction: "${instruction}"

Current Workflows:
${current_workflows.map((w, i) => `${i + 1}. ${w}`).join('\n')}

Please respond with a JSON object in this exact format:
{
  "workflows": ["workflow1", "workflow2", "workflow3"]
}`;

    const result = await model.generateContent(prompt);

    // Track LLM usage (fire-and-forget)
    const usageMetadata = result.response?.usageMetadata;
    if (usageMetadata) {
      console.log(`[WORKFLOW-LIST-EDIT] tracking usage: in=${usageMetadata.promptTokenCount}, out=${usageMetadata.candidatesTokenCount}`);
      trackLLMUsageAsync({
        model: modelName,
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        source: 'workflow_list_edit',
      });
    }

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
          const updatedList = JSON.parse(cleanedText);
          console.log('[SUCCESS] Vertex AI workflow list editing successful');
        return NextResponse.json(updatedList);
        } catch (parseError) {
          console.error('[ERROR] Failed to parse Vertex AI response as JSON:', parseError);
          console.log('🔍 Cleaned text:', cleanedText.substring(0, 300));
          console.log('🔄 Falling back to original workflows due to parsing error');
          return NextResponse.json({ workflows: current_workflows }, { status: 200 });
        }
    }
    
    console.error("No valid response from Vertex AI model:", response);
    console.log('🔄 Falling back to original workflows due to no response');
    return NextResponse.json({ workflows: current_workflows }, { status: 200 });

  } catch (error) {
    console.error('Error editing workflow list with Vertex AI:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 