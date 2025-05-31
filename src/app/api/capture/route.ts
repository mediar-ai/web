import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';
import fs from 'fs/promises'; // For file system operations
import path from 'path'; // For path manipulation

const MODEL_NAME = "gemini-2.5-flash-preview-05-20"; // User-provided model name

const LOG_FILE_PATH = path.join(process.cwd(), 'logs', 'backend_app.log');

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
    const imageDataBase64WithPrefix = body.image as string;
    const analysisText = body.analysisText as string;
    const clientTimestamp = body.timestamp as string;
    const userPrompt = (body.prompt as string) || "Analyze this screenshot for business workflow information.";
    const history = (body.history as string[]) || [];
    const isEventsSummary = body.isEventsSummary as boolean;
    const requestedModel = body.model as string;

    const modelName = requestedModel || MODEL_NAME;
    const activeModel = genAI.getGenerativeModel({ model: modelName });

    await writeToLog(`Received POST. Model: ${modelName}. Client Timestamp: ${clientTimestamp}. User Prompt: ${userPrompt.substring(0,100)}... History items: ${history.length}`);

    // Handle events summary request (text-only)
    if (isEventsSummary && analysisText) {
      // baseUserPrompt is no longer needed here as structuredPrompt is self-contained for schema guidance.
      // const baseUserPrompt = (body.prompt as string) || "Describe the user's action."; 

      // New prompt for structured output, guiding content for schema fields
      let structuredPrompt = `Based on the provided context, generate a thought process and a concise summary of the user's action. 
Thought Process: Explain your reasoning step-by-step for determining the user's primary action. 
Concise Summary: Provide the summary of the action in 10 words or less.`;

      if (history.length > 0) {
        structuredPrompt += `\n\nPrevious events context to consider for your thought process:\n`;
        history.slice(0, 3).forEach((h, index) => {
          structuredPrompt += `${index + 1}. ${h}\n`;
        });
        structuredPrompt += "\n";
      }
      structuredPrompt += `Main analysis context to use: ${analysisText}`;

      await writeToLog(`Sending events request to Gemini (${modelName}) for structured output. Prompt (first 200 chars): ${structuredPrompt.substring(0,200)}...`);
      
      const eventSummarySchema: Schema = {
        type: SchemaType.OBJECT,
        properties: {
          thoughts: { 
            type: SchemaType.STRING,
            description: "The model's detailed thought process for arriving at the summary." 
          },
          summary: { 
            type: SchemaType.STRING,
            description: "Concise summary of the user's action (10 words or less)."
          }
        },
        required: ['summary'] 
      };

      const generationConfig = {
        temperature: 0.3, 
        topK: 32,
        topP: 0.8,
        maxOutputTokens: 4096, // Increased significantly for thoughts + summary in JSON
        responseMimeType: "application/json", // Crucial for structured output
        responseSchema: eventSummarySchema     // Provide the defined schema
      };

      const result = await activeModel.generateContent({ 
        contents: [{ role: "user", parts: [{ text: structuredPrompt }] }], 
        generationConfig 
      });
      
      await writeToLog(`Raw Gemini events response (expecting JSON): ${JSON.stringify(result, null, 2)}`);
      
      const response = result.response;
      if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          const jsonString = candidate.content.parts
            .map(part => part.text || '')
            .join('')
            .trim();
          
          if (jsonString) {
            try {
              const structuredData = JSON.parse(jsonString);
              let thoughts = structuredData.thoughts || "Thoughts not provided by model."; // Fallback
              let summary = structuredData.summary || "Summary not provided by model.";   // Fallback

              // Check if the required summary is missing or truly empty despite schema requiring it.
              if (!structuredData.summary || String(structuredData.summary).trim() === ""){
                summary = "Summary was missing or empty in model output.";
                await writeToLog(`WARN: Gemini returned JSON but the required 'summary' field was missing or empty.`);
                // Thoughts might still be valuable
                thoughts = structuredData.thoughts || "Thoughts also missing or model output incomplete.";
              }
              
              if (summary === "Summary not provided by model." && thoughts === "Thoughts not provided by model.") {
                await writeToLog('WARN: Gemini returned JSON but with no thoughts or summary fields filled meaningfully.');
              }

              await writeToLog(`Gemini events response (structured JSON). Thoughts (first 50): ${thoughts.substring(0,50)}... Summary: ${summary}`);
              return NextResponse.json({
                message: 'Events summary and thoughts generated successfully (structured JSON).',
                analysis: { summary, thoughts }, // Already structured
                serverTimestamp: new Date().toISOString()
              });
            } catch (e) {
              await writeToLog(`ERROR: Failed to parse JSON response from Gemini for event summary. JSON String: ${jsonString}. Error: ${e}`);
              return NextResponse.json({ error: 'Failed to parse structured JSON from Gemini for event summary.', details: (e as Error).message }, { status: 500 });
            }
          }
        }
      }
      await writeToLog('WARN: Gemini events request (structured JSON attempt) failed or returned empty/invalid content part.');
      // Provide more context if possible for this warning case
      // let detailMessage = "Model did not return expected content parts for structured JSON.";
      // if (result && result.response && result.response.promptFeedback) {
      //   detailMessage += ` Prompt Feedback: ${JSON.stringify(result.response.promptFeedback)}`;
      // }
      // Simplified for linter diagnosis
      const simplifiedDetailMessage = "Model returned empty/invalid content.";
      return NextResponse.json({ error: 'Failed to generate events summary from Gemini response (structured JSON attempt).', details: simplifiedDetailMessage }, { status: 500 });
    }

    // Handle regular image analysis request
    if (!imageDataBase64WithPrefix || !imageDataBase64WithPrefix.startsWith('data:image/')) {
      await writeToLog('WARN: Invalid or missing image data in request.');
      return NextResponse.json({ error: 'Invalid or missing image data.' }, { status: 400 });
    }

    const parts = imageDataBase64WithPrefix.split(';base64,');
    if (parts.length !== 2) {
        await writeToLog('WARN: Malformed base64 image data.');
        return NextResponse.json({ error: 'Malformed base64 image data.' }, { status: 400 });
    }
    const mimeType = parts[0].split(':')[1];
    const imageDataBase64 = parts[1];

    await writeToLog(`Processing ${mimeType} image (size: ${imageDataBase64.length} chars)`);

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

    const generationConfig = {
      temperature: 0.3, 
      topK: 32,
      topP: 0.8,
      maxOutputTokens: 4096, // Keep it generous for potentially detailed facts in JSON
      responseMimeType: "application/json",
      responseSchema: mainAnalysisSchema
    };

    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    const imageInputPart: Part = { inlineData: { mimeType, data: imageDataBase64 } };
    
    // Enhanced prompt for more consistent structured output
    let fullPrompt = `Analyze the provided screenshot and recent activity context. Populate the defined JSON schema with your analysis. The schema fields are: workflow, step, description, facts, logic, tech, apps, and context. Refer to the schema field descriptions for specific instructions on what to populate in each. The original detailed instructions for each field (if they were part of the userPrompt) are also in this prompt below:\n\n${userPrompt}`;
    
    if (history.length > 0) {
      fullPrompt += `\n\nRecent activity context (last ${history.length} steps):\n`;
      history.slice(0, 5).forEach((h, index) => {
        fullPrompt += `${index + 1}. ${h}\n`;
      });
      fullPrompt += "\nBased on this context and the current screenshot, provide your analysis.";
    } else {
      fullPrompt += "\n\nThis is the first analysis with no previous context.";
    }

    const textInputPart: Part = { text: fullPrompt };
    const contents = [{ role: "user", parts: [imageInputPart, textInputPart] }];

    await writeToLog(`Sending request to Gemini (${modelName}). Prompt (first 200 chars): ${fullPrompt.substring(0,200)}...`);
    const result = await activeModel.generateContent({ contents, generationConfig, safetySettings });
    
    await writeToLog(`Raw Gemini response (expecting JSON for main analysis): ${JSON.stringify(result, null, 2)}`);
    
    const response = result.response;
    if (response && response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        const jsonString = candidate.content.parts // Expecting JSON string here
          .map(part => part.text || '')
          .join('')
          .trim();
        
        if (jsonString) {
          try {
            const structuredAnalysis = JSON.parse(jsonString);
            // Basic validation: check if a few key required fields are present
            if (!structuredAnalysis.workflow || !structuredAnalysis.step) {
              await writeToLog(`WARN: Gemini returned JSON for main analysis, but required fields like workflow or step are missing. Data: ${jsonString}`);
              // Fallback or handle as partial data
            }
            await writeToLog(`Gemini main analysis response (structured JSON processed). Step name: ${structuredAnalysis.step}`);
            return NextResponse.json({
              message: 'Capture analyzed successfully by Gemini (structured JSON).',
              analysis: structuredAnalysis, // Send the parsed JSON object directly
              receivedTimestamp: clientTimestamp,
              serverTimestamp: new Date().toISOString()
            });
          } catch (e) {
            await writeToLog(`ERROR: Failed to parse JSON response from Gemini for main analysis. JSON String: ${jsonString}. Error: ${e}`);
            return NextResponse.json({ error: 'Failed to parse structured JSON from Gemini for main analysis.', details: (e as Error).message }, { status: 500 });
          }
        } else {
          await writeToLog('WARN: Gemini returned empty analysis text (structured JSON attempt for main analysis).');
          return NextResponse.json({ error: 'Gemini returned empty analysis.', details: 'Empty text in parts (structured main analysis attempt)' }, { status: 500 });
        }
      } else {
        await writeToLog(`WARN: Gemini API content structure invalid. Content: ${JSON.stringify(candidate.content)}`);
        return NextResponse.json({ error: 'Gemini API returned invalid content structure.', details: 'No valid parts in content' }, { status: 500 });
      }
    } else {
      let feedbackMessage = "No candidates in response.";
      if (response && response.promptFeedback) {
        feedbackMessage = JSON.stringify(response.promptFeedback);
      }
      await writeToLog(`WARN: Gemini API returned no valid candidates. Response: ${JSON.stringify(response)}. Feedback: ${feedbackMessage}`);
      return NextResponse.json({ error: 'Gemini API returned no content.', details: feedbackMessage }, { status: 500 });
    }
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