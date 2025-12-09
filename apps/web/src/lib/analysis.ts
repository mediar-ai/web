import { getVertexGenAI } from '@/lib/vertexai';
import type { Part } from '@google/genai';

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

    // Track how many images we successfully add
    let imagesAdded = 0;
    let imageStatus = '';

    // Add JSON format instruction with handling for missing screenshots
    const uiDiffSchemaPrompt = `Please respond with a JSON object in this exact format:
{
  "change_detected": "yes or no - Was a change detected? If no screenshots were provided, respond with 'no_screenshots'",
  "change_description": "Natural language description of the change. If no screenshots were provided, state 'No screenshots available for comparison'",
  "identified_change_types": ["array", "of", "change", "types"],
  "mouse_movement_details": {
    "from_object": "string or null",
    "from_coordinate": "string or null",
    "to_object": "string or null",
    "to_coordinate": "string or null"
  },
  "typing_details": "string or null - Typed text if discernible",
  "click_details": "string or null - Object/area clicked if discernible",
  "screenshots_received": "Number of screenshots actually received for analysis"
}

IMPORTANT: If you do not see any screenshots attached to this message, set change_detected to "no_screenshots" and explain in change_description that no images were available.`;

    const parts: Part[] = [];

    // Add screenshots and track success/failure
    if (screenshotBefore) {
        const beforeParts = screenshotBefore.split(';base64,');
        if (beforeParts.length === 2) {
            const [mimeType, imageDataBase64] = [beforeParts[0].split(':')[1], beforeParts[1]];
            parts.push({ inlineData: { mimeType, data: imageDataBase64 } });
            imagesAdded++;
        } else {
            console.warn('[generateUiDiffAnalysis] ⚠️ screenshotBefore malformed - missing ;base64, delimiter');
        }
    } else {
        console.warn('[generateUiDiffAnalysis] ⚠️ screenshotBefore is empty/undefined');
    }

    if (screenshotAfter) {
        const afterParts = screenshotAfter.split(';base64,');
        if (afterParts.length === 2) {
            const [mimeType, imageDataBase64] = [afterParts[0].split(':')[1], afterParts[1]];
            parts.push({ inlineData: { mimeType, data: imageDataBase64 } });
            imagesAdded++;
        } else {
            console.warn('[generateUiDiffAnalysis] ⚠️ screenshotAfter malformed - missing ;base64, delimiter');
        }
    } else {
        console.warn('[generateUiDiffAnalysis] ⚠️ screenshotAfter is empty/undefined');
    }

    // Build image status for prompt
    if (imagesAdded === 0) {
        imageStatus = 'NOTE: No screenshots were successfully attached. Please indicate this in your response.';
    } else if (imagesAdded === 1) {
        imageStatus = 'NOTE: Only ONE screenshot was attached (expected 2 for comparison). Please indicate this limitation in your response.';
    } else {
        imageStatus = `NOTE: ${imagesAdded} screenshots attached for comparison.`;
    }

    console.log(`[generateUiDiffAnalysis] Images added: ${imagesAdded}/2`);

    const diffPrompt = `Compare these two sequential screenshots to identify UI changes. ${userPrompt}

${imageStatus}

${uiDiffSchemaPrompt}`;

    // Add prompt text AFTER images
    parts.push({ text: diffPrompt });

    const generationConfig = {
        temperature: 0.2,
    };

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

    // Track if screenshot was successfully added
    let hasScreenshot = false;

    // Use V2 field names for consistency with handling for missing screenshots
    const mainAnalysisSchemaPrompt = `Please respond with a JSON object in this exact format:
{
  "step_title": "Concise name for this specific step, 3-5 words max. If no screenshot available, use 'No Screenshot Available'",
  "step_summary": "What is happening in 10 or less words. If no screenshot available, state 'Screenshot not provided'",
  "user_intent": "Best guess of what the user is trying to accomplish",
  "what_was_clicked": "What UI element was clicked or interacted with",
  "what_was_typed": "Any text that was typed or entered",
  "how_content_changed": "How the screen content changed",
  "events_that_happened": "Key observable events from the screen. If no screenshot available, state 'No visual data available'",
  "results_if_any": "Any results or outcomes visible",
  "screenshot_available": true or false - whether a screenshot was provided for analysis
}

IMPORTANT: If no screenshot image is attached to this message, clearly indicate this in your response by setting screenshot_available to false and noting the limitation in relevant fields.`;

    const parts: Part[] = [];

    // Add screenshot first, then text
    if (screenshot) {
        const screenshotParts = screenshot.split(';base64,');
        if (screenshotParts.length === 2) {
            const [mimeType, imageDataBase64] = [screenshotParts[0].split(':')[1], screenshotParts[1]];
            parts.push({ inlineData: { mimeType, data: imageDataBase64 } });
            hasScreenshot = true;
        } else {
            console.warn('[generateMainAnalysis] ⚠️ screenshot malformed - missing ;base64, delimiter');
        }
    } else {
        console.warn('[generateMainAnalysis] ⚠️ screenshot is empty/undefined');
    }

    const screenshotStatus = hasScreenshot
        ? 'A screenshot is attached for analysis.'
        : 'NOTE: No screenshot was provided. Please indicate this limitation in your response.';

    console.log(`[generateMainAnalysis] Screenshot attached: ${hasScreenshot}`);

    const analysisPrompt = `Analyze this screenshot and UI tree to understand the current screen state. ${userPrompt}

${screenshotStatus}

UI Tree:
${uiTree || 'No UI tree provided'}

${mainAnalysisSchemaPrompt}`;

    parts.push({ text: analysisPrompt });

    const generationConfig = {
        temperature: 0.7,
    };

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