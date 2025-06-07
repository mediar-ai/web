import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';
import fs from 'fs/promises'; // For file system operations
import path from 'path'; // For path manipulation

const MODEL_NAME = "gemini-2.5-flash-preview-05-20"; // User-provided model name

const LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'backend_app.log');

// Type definition for activity summary
interface ActivitySummary {
  type: 'initial_dump' | 'ui_diff';
  timestamp: string;
  content_preview?: string;
  change_detected?: 'yes' | 'no';
  change_description?: string;
  change_types?: string[];
  new_content_preview?: string | null;
}

// Helper function to ensure log directory exists and append to log file
async function writeToLog(message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp}: ${message}\n`;
  try {
    await fs.mkdir(path.dirname(LOG_FILE_PATH), { recursive: true });
    await fs.appendFile(LOG_FILE_PATH, logEntry);
    console.log(logEntry.trim()); // Also log to console
  } catch (error) {
    console.error('Failed to write to log file:', error);
    console.error('Original log message:', logEntry.trim()); // Log original message to console if file write fails
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await writeToLog('ERROR: GEMINI_API_KEY is not set.');
    return NextResponse.json({ error: 'Server configuration error: Missing API key.' }, { status: 500 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const body = await request.json();
    // Expecting two images for UI Diff analysis, and one for original workflow analysis
    const image1_dataUrl = body.image1_dataUrl as string | undefined;
    const image2_dataUrl = body.image2_dataUrl as string | undefined;
    const single_imageDataBase64WithPrefix = body.image as string | undefined; // For old single-image analysis path

    const clientTimestamp = body.timestamp as string; // Might need array of timestamps for diff
    const userPrompt = (body.prompt as string) || "Analyze this screenshot for business workflow information.";
    const history = (body.history as string[]) || [];
    const analysisType = body.analysisType as string || 'workflow'; // New: 'workflow' or 'ui_diff'

    const modelName = MODEL_NAME; // Always use the flash model
    const requestOptions = { timeout: 1200000 }; // 20 minute timeout
    const activeModel = genAI.getGenerativeModel({ model: modelName, ...requestOptions });

    await writeToLog(`Received POST. Analysis Type: ${analysisType}. Model: ${modelName}. Client Timestamp: ${clientTimestamp}. User Prompt: ${userPrompt.substring(0,100)}... History items: ${history.length}`);

    // Handle multi-activity event analysis request (NEW)
    if (analysisType === 'multi_activity_event') {
      const activitiesSummary = body.activitiesSummary as ActivitySummary[];
      const previousEvents = body.previousEvents as Array<{summary: string, timestamp: string, isNewWorkflow: boolean}> || [];
      
      if (!activitiesSummary || activitiesSummary.length === 0) {
        await writeToLog('WARN: No activities provided for multi-activity event analysis.');
        return NextResponse.json({ error: 'No activities provided for analysis.' }, { status: 400 });
      }

      await writeToLog(`Processing Multi-Activity Event Analysis with ${activitiesSummary.length} activities and ${previousEvents.length} previous events`);

      const multiActivityEventSchema: Schema = {
        type: SchemaType.OBJECT,
        properties: {
          is_distinct_event: { 
            type: SchemaType.STRING, 
            description: "Is this a distinct new event compared to the recent events? Answer 'yes' if this represents a meaningful new action/transition, 'no' if it's a continuation of recent activity" 
          },
          description: { 
            type: SchemaType.STRING, 
            description: "Describe what is happening in this latest activity in 10 words or less" 
          }
        },
        required: ['is_distinct_event', 'description']
      };

      // Build a comprehensive prompt with all activities
      let multiActivityPrompt = `Analyze the following sequence of recent activities to generate a description and determine if this represents a distinct new event.

Recent Activities (newest first):
`;
      
      activitiesSummary.forEach((activity, index) => {
        multiActivityPrompt += `\n${index + 1}. [${activity.timestamp}] `;
        if (activity.type === 'initial_dump') {
          multiActivityPrompt += `Initial Screen Content: ${activity.content_preview}`;
        } else {
          multiActivityPrompt += `UI Change - Detected: ${activity.change_detected}`;
          if (activity.change_detected === 'yes') {
            if (activity.change_description) {
              multiActivityPrompt += `, Description: ${activity.change_description}`;
            }
            if (activity.change_types && activity.change_types.length > 0) {
              multiActivityPrompt += `, Types: ${activity.change_types.join(', ')}`;
            }
            if (activity.new_content_preview) {
              multiActivityPrompt += `, New Content: ${activity.new_content_preview}`;
            }
          }
        }
      });

      if (previousEvents.length > 0) {
        multiActivityPrompt += `\n\nPrevious Events (last ${previousEvents.length}, newest first):`;
        previousEvents.slice(0, 10).forEach((event, index) => {
          multiActivityPrompt += `\n${index + 1}. [${event.timestamp}] ${event.summary}`;
        });
      }

      multiActivityPrompt += `\n\nBased on these activities:
1. Generate a concise description (10 words or less) of what the user is doing in the LATEST activity
2. Determine if this represents a DISTINCT event compared to recent events
3. Consider an event distinct if it represents:
   - A new type of action (e.g., switching from browsing to typing)
   - A significant workflow transition
   - A meaningful change in user activity
4. If the activity is just a continuation of recent events (e.g., continuing to chat, continuing to browse), mark it as NOT distinct

User instruction: ${userPrompt}`;

      const multiActivityGenerationConfig = {
        temperature: 0.3,
        topK: 32,
        topP: 0.8,
        maxOutputTokens: 64192, // Increased to standard max, 65535 may be invalid for this model.
        responseMimeType: "application/json",
        responseSchema: multiActivityEventSchema
      };

      // Define safety settings (similar to other analysis types)
      const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];

      const result = await activeModel.generateContent({ 
        contents: [{ role: "user", parts: [{ text: multiActivityPrompt }] }], 
        generationConfig: multiActivityGenerationConfig,
        safetySettings // Added safetySettings
      });
      
      const response = result.response;
      if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        // Enhanced logging for candidate details
        await writeToLog(`Multi-activity event candidate details. Finish Reason: ${candidate.finishReason}. Safety Ratings: ${JSON.stringify(candidate.safetyRatings)}. Index: ${candidate.index}`);

        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          const jsonString = candidate.content.parts
            .map(part => part.text || '')
            .join('')
            .trim();
          
          if (jsonString) {
            try {
              const eventAnalysis = JSON.parse(jsonString);

              // User-requested override: If there are no previous events, mark as distinct.
              if (previousEvents.length === 0) {
                if (eventAnalysis.is_distinct_event !== 'yes') {
                  await writeToLog(`INFO: Overriding event to 'distinct: yes' because no previous events were found. Original model output was 'distinct: ${eventAnalysis.is_distinct_event}'.`);
                  eventAnalysis.is_distinct_event = 'yes';
                } else {
                  await writeToLog(`INFO: Event already 'distinct: yes' and no previous events were found. No override needed. Model output was 'distinct: ${eventAnalysis.is_distinct_event}'.`);
                }
              }

              await writeToLog(`Multi-activity event analysis successful. Distinct: ${eventAnalysis.is_distinct_event}, Description: ${eventAnalysis.description}`);
              return NextResponse.json({
                message: 'Multi-activity event analyzed successfully.',
                analysis: eventAnalysis,
                serverTimestamp: new Date().toISOString()
              });
            } catch (e) {
              await writeToLog(`ERROR: Failed to parse JSON for multi-activity event. JSON String: "${jsonString}". Raw Candidate Parts: ${JSON.stringify(candidate.content.parts)}. Full Candidate: ${JSON.stringify(candidate)}. Error: ${(e as Error).message}`);
              // Fall through to generic error below
            }
          } else {
            await writeToLog(`WARN: Gemini multi-activity event returned empty jsonString. Raw Candidate Parts: ${JSON.stringify(candidate.content.parts)}. Full Candidate: ${JSON.stringify(candidate)}`);
            // Fall through to generic error below
          }
        } else {
           await writeToLog(`WARN: Gemini multi-activity event returned no content parts in candidate. Full Candidate: ${JSON.stringify(candidate)}`);
           // Fall through to generic error below
        }
      } else {
        await writeToLog(`WARN: Gemini multi-activity event request returned no candidates or response. Full API Result: ${JSON.stringify(result)}`);
        // Fall through to generic error below
      }
      // Generic error handler if not returned successfully above
      await writeToLog('WARN: Gemini multi-activity event request failed (details logged above) or resulted in an unusable structure.');
      return NextResponse.json({ error: 'Failed to generate multi-activity event analysis.' }, { status: 500 });
    }

    // Handle UI Diff analysis request (NEW)
    if (analysisType === 'ui_diff' && image1_dataUrl && image2_dataUrl) {
      await writeToLog('Processing UI Diff Analysis Request');
      const imageParts: Part[] = [];
      
      for (const url of [image1_dataUrl, image2_dataUrl]) {
        const parts = url.split(';base64,');
        if (parts.length !== 2) { return NextResponse.json({ error: 'Malformed base64 image data for UI Diff.' }, { status: 400 }); }
        imageParts.push({ inlineData: { mimeType: parts[0].split(':')[1], data: parts[1] } });
      }

      const uiDiffAnalysisSchema: Schema = {
        type: SchemaType.OBJECT,
        properties: {
          change_detected: { type: SchemaType.STRING, description: "Was a change detected between the two screenshots? (Respond with 'yes' or 'no')" },
          change_description: { type: SchemaType.STRING, description: "If yes, a natural language description of the overall change." },
          identified_change_types: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "List: mouse movement, scrolling, typing, left-click, right-click, new window, new app, other." },
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

      const diffPrompt = `Compare these two sequential screenshots. Populate the JSON schema to describe changes. 
Image 1 is the 'before' state, Image 2 is the 'after' state. 
Schema fields include 'change_detected' ("yes"/"no"), 'change_description', and 'identified_change_types'. 
For 'identified_change_types', you MUST provide an array listing ALL distinct types of changes observed between Image 1 and Image 2. Choose from the following predefined types: 'mouse movement', 'scrolling', 'typing', 'left-click', 'right-click', 'new window appeared', 'new app appeared'. 
If a change doesn't fit these, list it as 'other'. 
Ensure all observed change types are included in this array if multiple types of changes occurred. 
Also populate detailed fields (like 'mouse_movement_details', 'typing_details', etc.) for each identified type where applicable. If a detail field is not applicable, omit it or leave it null. 
If you identify a change type as 'other', detail it in 'other_change_details'. 
Use 'unidentified_changes_explanation' if the schema limits full description of other important changes not covered. 
For 'new_content_detected', list in maximum detail all NEW raw text, UI elements, or other visual information that appeared in Image 2 that was NOT visible or present in Image 1. Focus only on the delta of newly appeared content. 
The userPrompt contains general instructions: ${userPrompt}`;

      const diffGenerationConfig = {
        temperature: 0.2, topK: 32, topP: 0.8, maxOutputTokens: 64192, // Increased from 4096
        responseMimeType: "application/json", responseSchema: uiDiffAnalysisSchema
      };

      const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];

      const diffContents = [{ role: "user", parts: [...imageParts, {text: diffPrompt}] }];
      const streamResult = await activeModel.generateContentStream({ contents: diffContents, generationConfig: diffGenerationConfig, safetySettings });
      
      // Create a streamed response for the JSON output
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            // Although we expect a single JSON object, we process it as a stream
            // to prevent timeouts. The model might send it in chunks.
            let accumulatedJson = '';
            for await (const chunk of streamResult.stream) {
              const chunkText = chunk.text();
              if (chunkText) {
                accumulatedJson += chunkText;
                // We don't enqueue partial JSON, we build the full string first
              }
            }
            // Once the stream is finished, enqueue the complete JSON string
            controller.enqueue(new TextEncoder().encode(accumulatedJson));
            await writeToLog('Gemini UI Diff stream finished successfully.');
            controller.close();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown streaming error';
            await writeToLog(`ERROR: Streaming UI Diff from Gemini failed: ${errorMessage}`);
            controller.error(error);
          }
        }
      });

      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8', // Ensure correct MIME type for JSON
          'X-Content-Type-Options': 'nosniff',
        }
      });
    }

    // Handle regular single-image workflow analysis request (MODIFIED - this is the original main analysis path)
    if (analysisType === 'workflow' && single_imageDataBase64WithPrefix) {
      await writeToLog('Processing Single Image Workflow Analysis Request');
      const parts = single_imageDataBase64WithPrefix.split(';base64,');
      if (parts.length !== 2) {
          await writeToLog('WARN: Malformed base64 image data for workflow analysis.');
          return NextResponse.json({ error: 'Malformed base64 image data.' }, { status: 400 });
      }
      const mimeType = parts[0].split(':')[1];
      const imageDataBase64 = parts[1];
      await writeToLog(`Processing ${mimeType} image (size: ${imageDataBase64.length} chars)`);

      // Schema for single-image workflow analysis (remains the same as before)
      const mainAnalysisSchema: Schema = { 
        type: SchemaType.OBJECT,
        properties: {
            workflow: { type: SchemaType.STRING, description: "Best guess of the overall workflow/process name based on what you see." },
            step: { type: SchemaType.STRING, description: "Concise name for this specific step, 3-5 words max." },
            description: { type: SchemaType.STRING, description: "What is happening in 10 or less words. Focus on fresh and unique information compared to previous logs, what has changed." },
            facts: { type: SchemaType.STRING, description: "Key observable facts from the screen - buttons, text, UI elements, data visible. Can be a list or paragraph." },
            logic: { type: SchemaType.STRING, description: "Business rules or logic you can infer from this step." },
            tech: { type: SchemaType.STRING, description: "Technical details like application, browser, file types, etc." },
            apps: { type: SchemaType.STRING, description: "List of applications, windows, or programs visible on screen. Can be a list or paragraph." },
            context: { type: SchemaType.STRING, description: "Specific context like browser tab titles, URLs, file names, chat names, document titles, etc. if available." }
        },
        required: ['workflow', 'step', 'description', 'facts', 'logic', 'tech', 'apps', 'context']
       }; 

      const workflowGenerationConfig = {
        temperature: 0.3, 
        topK: 32,
        topP: 0.8,
        maxOutputTokens: 64192, // Increased from 4096
        responseMimeType: "application/json",
        responseSchema: mainAnalysisSchema
      };
      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];
      // Prompt for single-image workflow analysis (remains the same as before)
      let workflowFullPrompt = `Analyze the provided screenshot and recent activity context. Populate the defined JSON schema with your analysis. The schema fields are: workflow, step, description, facts, logic, tech, apps, and context. Refer to the schema field descriptions for specific instructions on what to populate in each. The original detailed instructions for each field (if they were part of the userPrompt) are also in this prompt below:\n\n${userPrompt}`;
      if (history.length > 0) { workflowFullPrompt += `\n\nRecent activity context (last ${history.length} steps):\n`; history.slice(0, 5).forEach((h, index) => { workflowFullPrompt += `${index + 1}. ${h}\n`; }); workflowFullPrompt += "\nBased on this context and the current screenshot, provide your analysis."; } else { workflowFullPrompt += "\n\nThis is the first analysis with no previous context."; }

      const imageInputPart: Part = { inlineData: { mimeType, data: imageDataBase64 } };
      const textInputPart: Part = { text: workflowFullPrompt };
      const workflowContents = [{ role: "user", parts: [imageInputPart, textInputPart] }];

      await writeToLog(`Sending request to Gemini (${modelName}) for workflow analysis. Prompt (first 200 chars): ${workflowFullPrompt.substring(0,200)}...`);
      const workflowResult = await activeModel.generateContent({ contents: workflowContents, generationConfig: workflowGenerationConfig, safetySettings });
      
      const workflowResponse = workflowResult.response;
      if (workflowResponse && workflowResponse.candidates && workflowResponse.candidates.length > 0) {
          const candidate = workflowResponse.candidates[0];
          if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
              const jsonString = candidate.content.parts.map(part => part.text || '').join('').trim();
              if (jsonString) {
                  try {
                      const structuredAnalysis = JSON.parse(jsonString);
                      if (!structuredAnalysis.workflow || !structuredAnalysis.step) { await writeToLog(`WARN: Workflow JSON missing required fields. Data: ${jsonString}`); }
                      await writeToLog(`Gemini workflow analysis (JSON processed). Step: ${structuredAnalysis.step}`);
                      return NextResponse.json({ message: 'Capture analyzed (workflow JSON).', analysis: structuredAnalysis, receivedTimestamp: clientTimestamp, serverTimestamp: new Date().toISOString() });
                  } catch (e) {
                      await writeToLog(`ERROR: Failed to parse workflow JSON. String: ${jsonString}. Error: ${e}`);
                      return NextResponse.json({ error: 'Failed to parse workflow JSON.', details: (e as Error).message }, { status: 500 });
                  }
              }
          }
      }
      await writeToLog('WARN: Gemini workflow analysis request failed or returned empty.');
      return NextResponse.json({ error: 'Failed to generate workflow analysis.' }, { status: 500 });
    }

    // Handle Initial Frame Raw Content Dump (NEW)
    if (analysisType === 'initial_frame_dump' && single_imageDataBase64WithPrefix) {
      await writeToLog('Processing Initial Frame Raw Content Dump Request');
      const parts = single_imageDataBase64WithPrefix.split(';base64,');
      if (parts.length !== 2) {
        await writeToLog('WARN: Malformed base64 image data for initial frame dump.');
        return NextResponse.json({ error: 'Malformed base64 image data.' }, { status: 400 });
      }
      const mimeType = parts[0].split(':')[1];
      const imageDataBase64 = parts[1];
      await writeToLog(`Processing ${mimeType} image (size: ${imageDataBase64.length} chars) for initial dump`);

      const dumpPrompt = "Extract all visible text from this image. List every piece of text you can see including: UI labels, buttons, menu items, headings, body text, form fields, error messages, tooltips, navigation items, and any other text content. Organize the text by screen regions or UI components where possible.";
      
      const dumpModelName = "gemini-2.5-flash-preview-05-20"; // Use flash model for OCR
      const dumpActiveModel = genAI.getGenerativeModel({ model: dumpModelName, ...requestOptions });

      // For a raw text dump, we might not need a complex schema, or a very simple one.
      // Let's try without a specific responseSchema first, expecting text.
      // Or, define a simple schema if we want to ensure it's under a specific key.
      const dumpGenerationConfig = {
        temperature: 0.1, // Low temperature for factual listing
        topK: 32,
        topP: 0.8,
        maxOutputTokens: 64192, // Increased from 4096
        // No responseMimeType or responseSchema specified to get default text output
      };
      const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];

      const imageInputPart: Part = { inlineData: { mimeType, data: imageDataBase64 } };
      const textInputPart: Part = { text: dumpPrompt };
      const dumpContents = [{ role: "user", parts: [imageInputPart, textInputPart] }];

      await writeToLog(`Sending request to Gemini (${dumpModelName}) for initial frame dump. Prompt: ${dumpPrompt}`);
      
      const streamResult = await dumpActiveModel.generateContentStream({ contents: dumpContents, generationConfig: dumpGenerationConfig, safetySettings });
      
      // Create a streamed response
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResult.stream) {
              const chunkText = chunk.text();
              if (chunkText) {
                controller.enqueue(new TextEncoder().encode(chunkText));
              }
            }
            await writeToLog('Gemini initial frame dump stream finished successfully.');
            controller.close();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown streaming error';
            await writeToLog(`ERROR: Streaming from Gemini failed: ${errorMessage}`);
            controller.error(error);
          }
        }
      });
      
      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        }
      });
    }
    
    // Fallback if no appropriate handler was found
    await writeToLog('WARN: No specific analysis type matched or required data missing.');
    return NextResponse.json({ error: 'Invalid request parameters or analysis type.' }, { status: 400 });

  } catch (error) {
    let errorMessage = 'An unknown error occurred while processing the image.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    await writeToLog(`ERROR: Processing request or calling Gemini: ${errorMessage}`);
    await writeToLog(`ERROR: Full error object: ${JSON.stringify(error)}`);
    
    if (error instanceof SyntaxError && request.headers.get("content-length") === "0") {
      await writeToLog('ERROR: Received empty request body (SyntaxError).');
      errorMessage = "Request body is empty or malformed JSON.";
      return NextResponse.json({ error: 'Failed to process capture request.', details: errorMessage }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to process image with Gemini.', details: errorMessage }, { status: 500 });
  }
} 