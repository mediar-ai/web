import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part } from '@google/generative-ai';
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
      let fullPrompt = userPrompt;
      if (history.length > 0) {
        fullPrompt += `\n\nPrevious events context:\n`;
        history.slice(0, 3).forEach((h, index) => {
          fullPrompt += `${index + 1}. ${h}\n`;
        });
      }
      fullPrompt += `\n\nAnalysis to summarize: ${analysisText}`;

      await writeToLog(`Sending events request to Gemini (${modelName}). Prompt (first 200 chars): ${fullPrompt.substring(0,200)}...`);
      
      const generationConfig = {
        temperature: 0.3, 
        topK: 32,
        topP: 0.8,
        maxOutputTokens: 500, // Increased for pro model thinking tokens
      };

      const result = await activeModel.generateContent({ 
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }], 
        generationConfig 
      });
      
      await writeToLog(`Raw Gemini events response: ${JSON.stringify(result, null, 2)}`);
      
      const response = result.response;
      if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          const eventSummary = candidate.content.parts
            .map(part => part.text || '')
            .join('')
            .trim();
          
          if (eventSummary) {
            await writeToLog(`Gemini events response successful (length: ${eventSummary.length}): ${eventSummary}`);
            return NextResponse.json({
              message: 'Events summary generated successfully.',
              analysis: eventSummary,
              serverTimestamp: new Date().toISOString()
            });
          }
        }
      }
      await writeToLog('WARN: Gemini events request failed or returned empty response.');
      return NextResponse.json({ error: 'Failed to generate events summary.' }, { status: 500 });
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

    const generationConfig = {
      temperature: 0.3, 
      topK: 32,
      topP: 0.8,
      maxOutputTokens: 8192,
    };

    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    const imageInputPart: Part = { inlineData: { mimeType, data: imageDataBase64 } };
    
    // Enhanced prompt for more consistent structured output
    let fullPrompt = userPrompt;
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
    
    await writeToLog(`Raw Gemini response: ${JSON.stringify(result, null, 2)}`);
    
    const response = result.response;
    if (response && response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        const analysisText = candidate.content.parts
          .map(part => part.text || '')
          .join('')
          .trim();
        
        if (analysisText) {
          await writeToLog(`Gemini response successful (length: ${analysisText.length}): ${analysisText.substring(0, 200)}...`);
          return NextResponse.json({
            message: 'Capture analyzed successfully by Gemini.',
            analysis: analysisText,
            receivedTimestamp: clientTimestamp,
            serverTimestamp: new Date().toISOString()
          });
        } else {
          await writeToLog('WARN: Gemini returned empty analysis text.');
          return NextResponse.json({ error: 'Gemini returned empty analysis.', details: 'Empty text in parts' }, { status: 500 });
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