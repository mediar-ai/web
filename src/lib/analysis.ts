import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';

const MODEL_NAME = "gemini-2.5-flash-preview-05-20";

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  return new GoogleGenerativeAI(apiKey);
}

export interface ActivitySummary {
    type: 'initial_dump' | 'ui_diff';
    timestamp: string;
    content_preview?: string;
    change_detected?: 'yes' | 'no';
    change_description?: string;
    change_types?: string[];
    new_content_preview?: string | null;
}

// Reusable safety settings
const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export async function analyzeMultiActivityEvent(
    activitiesSummary: ActivitySummary[],
    previousEvents: Array<{summary: string, timestamp: string}>,
    userPrompt: string
) {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const multiActivityEventSchema: Schema = {
        type: SchemaType.OBJECT,
        properties: {
          is_distinct_event: { type: SchemaType.STRING, description: "Is this a distinct new event? 'yes' or 'no'" },
          description: { type: SchemaType.STRING, description: "Describe what is happening in the latest activity in 10 words or less" }
        },
        required: ['is_distinct_event', 'description']
    };

    let multiActivityPrompt = `Analyze the following sequence of recent activities:\n`;
    activitiesSummary.forEach((activity, index) => {
        multiActivityPrompt += `\n${index + 1}. [${activity.timestamp}] ${activity.type}: ${activity.content_preview || activity.change_description}`;
    });

    if (previousEvents.length > 0) {
        multiActivityPrompt += `\n\nPrevious Events:\n`;
        previousEvents.slice(0, 5).forEach((event, index) => {
            multiActivityPrompt += `\n${index + 1}. [${event.timestamp}] ${event.summary}`;
        });
    }
    multiActivityPrompt += `\n\nUser instruction: ${userPrompt}`;

    const generationConfig = {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: multiActivityEventSchema
    };

    const result = await model.generateContent({ 
        contents: [{ role: "user", parts: [{ text: multiActivityPrompt }] }], 
        generationConfig,
        safetySettings
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const jsonString = response.candidates[0].content.parts[0].text;
        const analysis = JSON.parse(jsonString);
        if (previousEvents.length === 0) {
            analysis.is_distinct_event = 'yes';
        }
        return analysis;
    }
    throw new Error('Failed to generate multi-activity event analysis.');
}

export async function analyzeUIDiff(
    image1_dataUrl: string,
    image2_dataUrl: string,
    userPrompt: string
): Promise<Record<string, unknown>> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const imageParts: Part[] = [];

    // Handle the "before" image only if it's a valid data URL
    if (image1_dataUrl && image1_dataUrl.includes(';base64,')) {
        const base64StartIndex1 = image1_dataUrl.indexOf(';base64,');
        const mimeType1 = image1_dataUrl.substring(image1_dataUrl.indexOf(':') + 1, base64StartIndex1);
        const base64Data1 = image1_dataUrl.substring(base64StartIndex1 + 8);
        imageParts.push({ inlineData: { mimeType: mimeType1, data: base64Data1 } });
    }

    // Always process the "after" image
    const base64StartIndex2 = image2_dataUrl.indexOf(';base64,');
    if (base64StartIndex2 === -1) {
        throw new Error('Malformed data URL for after_image: could not find ;base64,');
    }
    const mimeType2 = image2_dataUrl.substring(image2_dataUrl.indexOf(':') + 1, base64StartIndex2);
    const base64Data2 = image2_dataUrl.substring(base64StartIndex2 + 8);
    imageParts.push({ inlineData: { mimeType: mimeType2, data: base64Data2 } });

    const uiDiffAnalysisSchema: Schema = {
      type: SchemaType.OBJECT,
      properties: {
        change_detected: { type: SchemaType.STRING, description: "Was a change detected? ('yes'/'no')" },
        change_description: { type: SchemaType.STRING, description: "Natural language description of the change." },
        identified_change_types: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "List of change types." },
        mouse_movement_details: { type: SchemaType.OBJECT, properties: { from_object: {type: SchemaType.STRING}, from_coordinate: {type: SchemaType.STRING}, to_object: {type: SchemaType.STRING}, to_coordinate: {type: SchemaType.STRING}}, description: "Mouse movement details.", nullable: true },
        typing_details: { type: SchemaType.STRING, description: "Typed text if discernible.", nullable: true },
        click_details: { type: SchemaType.STRING, description: "Object/area clicked. Specify L/R click.", nullable: true },
        new_window_details: { type: SchemaType.OBJECT, properties: { old_window_name: {type: SchemaType.STRING}, new_window_name: {type: SchemaType.STRING}}, description: "New window details.", nullable: true },
        new_app_details: { type: SchemaType.STRING, description: "Name of new app.", nullable: true },
        scroll_details: { type: SchemaType.OBJECT, properties: {new_content_summary: {type: SchemaType.STRING}}, description: "Summary of what and where the user scrolled.", nullable: true },
        other_change_details: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { type_description: {type: SchemaType.STRING}, details: {type: SchemaType.STRING}}}, description: "Other changes.", nullable: true },
        unidentified_changes_explanation: { type: SchemaType.STRING, description: "If important changes were missed by schema, explain here.", nullable: true },
        new_content_detected: { type: SchemaType.STRING, description: "List in maximum detail all NEW raw text, UI elements, or other visual information that appeared in Image 2 that was NOT visible or present in Image 1. Focus only on the delta of newly appeared content.", nullable: true }
      },
      required: ['change_detected']
    };

    const diffPrompt = `Compare these two sequential screenshots... ${userPrompt}`;
    const generationConfig = {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: uiDiffAnalysisSchema
    };
    const contents = [{ role: "user", parts: [...imageParts, { text: diffPrompt }] }];

    const result = await model.generateContent({ contents, generationConfig, safetySettings });
    
    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return JSON.parse(response.candidates[0].content.parts[0].text);
    }
    throw new Error('Failed to analyze UI diff.');
}

export async function analyzeWorkflow(
    imageDataBase64WithPrefix: string,
    history: string[],
    userPrompt: string
): Promise<Record<string, unknown>> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    
    const parts = imageDataBase64WithPrefix.split(';base64,');
    if (parts.length !== 2) throw new Error('Malformed base64 image data.');
    const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];

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
    
    let fullPrompt = `Analyze the screenshot... ${userPrompt}`;
    if (history.length > 0) {
        fullPrompt += `\n\nRecent activity:\n${history.slice(0, 5).join('\n')}`;
    }

    const imagePart: Part = { inlineData: { mimeType, data: imageDataBase64 } };
    const textPart: Part = { text: fullPrompt };
    
    const result = await model.generateContent({
        contents: [{ role: "user", parts: [imagePart, textPart] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: mainAnalysisSchema },
        safetySettings
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return JSON.parse(response.candidates[0].content.parts[0].text);
    }
    throw new Error('Failed to generate workflow analysis.');
}

export async function performInitialFrameDump(
    imageDataBase64WithPrefix: string
): Promise<ReadableStream<Uint8Array>> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const parts = imageDataBase64WithPrefix.split(';base64,');
    if (parts.length !== 2) {
        throw new Error('Malformed base64 image data');
    }
    const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];

    const dumpPrompt = "Extract all visible text from this image...";
    const imagePart: Part = { inlineData: { mimeType, data: imageDataBase64 } };
    const textPart: Part = { text: dumpPrompt };
    const contents = [{ role: "user", parts: [imagePart, textPart] }];

    const result = await model.generateContentStream({ contents, safetySettings });
    
    return new ReadableStream({
        async start(controller) {
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                if (chunkText) {
                    controller.enqueue(new TextEncoder().encode(chunkText));
                }
            }
            controller.close();
        }
    });
}

export async function analyzeTextEvent(text: string, prompt: string): Promise<string> {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const fullPrompt = `${prompt}\n\nEvent Data: "${text}"`;
    const result = await model.generateContent(fullPrompt);
    return result.response.text();
} 