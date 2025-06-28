import { NextRequest, NextResponse } from 'next/server';
// import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT } from '@/lib/prompts';
// import { v2AnalysisSchema } from '@/lib/llmSchemas';

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
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 🔥 SWITCHED TO VERTEX AI 🔥
    console.log('🚀 Using Vertex AI for workflow event generation with model:', modelName);
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
    });
    
    const prompt = `${WORKFLOW_STEP_ANALYSIS_V2_PROMPT}

CONTEXT:
${JSON.stringify(context, null, 2)}

Please respond with a JSON object in this exact format:
{
  "step_title": "Clear, action-oriented title for this step",
  "step_summary": "Brief summary of what the user accomplished in this step",
  "events_that_happened": "Specific user actions: clicks, keystrokes, navigation, scrolling, etc.",
  "how_content_changed": "What changed on the screen as a result of the user's actions",
  "results_if_any": "Outcomes, confirmations, errors, notifications, or responses from the system",
  "what_was_clicked": "Specific UI elements that were clicked",
  "what_was_typed": "Text input by the user, if any",
  "user_intent": "The user's likely goal or intention behind this action"
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
          const analysisData = JSON.parse(cleanedText);
          console.log('✅ Vertex AI workflow event generation successful');
        
        // Add schema version to mark as V2
        const v2Analysis = {
          ...analysisData,
          schema_version: 'v2'
        };
        
        return NextResponse.json(v2Analysis);
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
    return NextResponse.json({ error: 'Failed to generate workflow analysis from the Vertex AI model.' }, { status: 500 });

  } catch (error) {
    console.error('Error generating workflow event with Vertex AI:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 