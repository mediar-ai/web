import { getVertexGenAI } from '@/lib/vertexai';
import type { Part } from '@google-cloud/vertexai';

const MODEL_NAME = "gemini-2.5-flash";

// 🔥 SWITCHED TO VERTEX AI 🔥
function getGenAI() {
  console.log('🚀 Using Vertex AI for analysis');
  return getVertexGenAI();
}

export async function generateMultiActivityEventAnalysis(
    activities: unknown[],
    userPrompt: string = ""
): Promise<{ is_distinct_event: string; description: string }> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
    });

    let multiActivityPrompt = `Analyze this sequence of activities:\n\n`;
    activities.forEach((activity, index) => {
        multiActivityPrompt += `Activity ${index + 1}:\n${JSON.stringify(activity, null, 2)}\n\n`;
    });

    multiActivityPrompt += `Based on the latest activity in this sequence, determine if this represents a distinct new event or if it's part of the same ongoing activity.`;
    
    if (userPrompt) {
        multiActivityPrompt += `\n\nUser instruction: ${userPrompt}`;
    }

    // Add JSON format instruction
    multiActivityPrompt += `\n\nPlease respond with a JSON object in this exact format:
{
  "is_distinct_event": "yes or no - Is this a distinct new event?",
  "description": "Describe what is happening in the latest activity in 10 words or less"
}`;

    const generationConfig = {
        temperature: 0.3,
    };

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: multiActivityPrompt }] }],
            generationConfig,
        });

        const response = result.response;
        if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            let responseText = response.candidates[0].content.parts[0].text;
            // Remove markdown code blocks if present
            responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
            const analysisResult = JSON.parse(responseText);
            return analysisResult;
        }

        throw new Error('No valid response from model');
    } catch (error) {
        console.error('Error in generateMultiActivityEventAnalysis:', error);
        throw error;
    }
}

export async function generateUiDiffAnalysis(
    screenshotBefore: string,
    screenshotAfter: string,
    userPrompt: string = ""
): Promise<unknown> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
    });

    // Add JSON format instruction
    const uiDiffSchemaPrompt = `Please respond with a JSON object in this exact format:
{
  "change_detected": "yes or no - Was a change detected?",
  "change_description": "Natural language description of the change",
  "identified_change_types": ["array", "of", "change", "types"],
  "mouse_movement_details": {
    "from_object": "string or null",
    "from_coordinate": "string or null", 
    "to_object": "string or null",
    "to_coordinate": "string or null"
  },
  "typing_details": "string or null - Typed text if discernible",
  "click_details": "string or null - Object/area clicked if discernible"
}`;

    const diffPrompt = `Compare these two sequential screenshots... ${userPrompt}\n\n${uiDiffSchemaPrompt}`;
    const generationConfig = {
        temperature: 0.2,
    };

    const parts: Part[] = [{ text: diffPrompt }];

    // Add screenshots
    if (screenshotBefore) {
        const beforeParts = screenshotBefore.split(';base64,');
        if (beforeParts.length === 2) {
            const [mimeType, imageDataBase64] = [beforeParts[0].split(':')[1], beforeParts[1]];
            parts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }

    if (screenshotAfter) {
        const afterParts = screenshotAfter.split(';base64,');
        if (afterParts.length === 2) {
            const [mimeType, imageDataBase64] = [afterParts[0].split(':')[1], afterParts[1]];
            parts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig,
        });

        const response = result.response;
        if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            let responseText = response.candidates[0].content.parts[0].text;
            // Remove markdown code blocks if present
            responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
            const analysisResult = JSON.parse(responseText);
            return analysisResult;
        }

        throw new Error('No valid response from model');
    } catch (error) {
        console.error('Error in generateUiDiffAnalysis:', error);
        throw error;
    }
}

export async function generateMainAnalysis(
    screenshot: string,
    uiTree: string,
    userPrompt: string = ""
): Promise<unknown> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
    });

    // Use V2 field names for consistency
    const mainAnalysisSchemaPrompt = `Please respond with a JSON object in this exact format:
{
  "step_title": "Concise name for this specific step, 3-5 words max",
  "step_summary": "What is happening in 10 or less words",
  "user_intent": "Best guess of what the user is trying to accomplish",
  "what_was_clicked": "What UI element was clicked or interacted with",
  "what_was_typed": "Any text that was typed or entered",
  "how_content_changed": "How the screen content changed",
  "events_that_happened": "Key observable events from the screen",
  "results_if_any": "Any results or outcomes visible"
}`;

    const analysisPrompt = `Analyze this screenshot and UI tree... ${userPrompt}\n\nUI Tree:\n${uiTree}\n\n${mainAnalysisSchemaPrompt}`;
    const generationConfig = {
        temperature: 0.7,
    };

    const parts: Part[] = [{ text: analysisPrompt }];

    // Add screenshot
    if (screenshot) {
        const screenshotParts = screenshot.split(';base64,');
        if (screenshotParts.length === 2) {
            const [mimeType, imageDataBase64] = [screenshotParts[0].split(':')[1], screenshotParts[1]];
            parts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig,
        });

        const response = result.response;
        if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            let responseText = response.candidates[0].content.parts[0].text;
            // Remove markdown code blocks if present
            responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
            const analysisResult = JSON.parse(responseText);
            return analysisResult;
        }

        throw new Error('No valid response from model');
    } catch (error) {
        console.error('Error in generateMainAnalysis:', error);
        throw error;
    }
} 