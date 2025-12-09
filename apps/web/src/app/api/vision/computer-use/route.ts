import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Environment } from '@google/genai';
import { getRedisClient } from '@/lib/redis-client';

// Vercel Pro: 5 minute timeout for computer use model
export const maxDuration = 300;

// Rate limits
const RATE_LIMIT_IP_PER_MIN = 100;
const RATE_LIMIT_GLOBAL_PER_MIN = 100;
const RATE_LIMIT_GLOBAL_PER_DAY = 1000;

// Model for computer use - the dedicated computer use model
const COMPUTER_USE_MODEL = 'gemini-2.5-computer-use-preview-10-2025';

/**
 * Check rate limits using Redis
 */
async function checkRateLimit(ip: string): Promise<NextResponse | null> {
  try {
    const redis = await getRedisClient();
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const currentDay = Math.floor(now / 86400000);

    const ipKey = `vision:computer-use:ip:${ip}:${currentMinute}`;
    const globalMinKey = `vision:computer-use:global:min:${currentMinute}`;
    const globalDayKey = `vision:computer-use:global:day:${currentDay}`;

    const [ipCount, globalMinCount, globalDayCount] = await Promise.all([
      redis.incr(ipKey),
      redis.incr(globalMinKey),
      redis.incr(globalDayKey),
    ]);

    if (ipCount === 1) await redis.expire(ipKey, 120);
    if (globalMinCount === 1) await redis.expire(globalMinKey, 120);
    if (globalDayCount === 1) await redis.expire(globalDayKey, 90000);

    if (ipCount > RATE_LIMIT_IP_PER_MIN) {
      console.log(`[Computer Use API] Rate limit exceeded for IP ${ip}`);
      return NextResponse.json(
        { error: 'Rate limit exceeded: max 10 requests per minute per IP' },
        { status: 429 }
      );
    }

    if (globalMinCount > RATE_LIMIT_GLOBAL_PER_MIN) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: service is busy' },
        { status: 429 }
      );
    }

    if (globalDayCount > RATE_LIMIT_GLOBAL_PER_DAY) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: daily limit reached' },
        { status: 429 }
      );
    }

    return null;
  } catch (error) {
    console.error('[Computer Use API] Rate limit check failed:', error);
    return null;
  }
}

/**
 * Function call from Gemini Computer Use model
 */
interface ComputerUseFunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/**
 * Response from Computer Use API
 */
interface ComputerUseResponse {
  // True if task is complete (no more actions needed)
  completed: boolean;
  // Function call if action is needed
  function_call?: ComputerUseFunctionCall;
  // Text response from model (reasoning or final answer)
  text?: string;
  // Safety decision if confirmation required
  safety_decision?: 'allowed' | 'require_confirmation';
  // Timing
  duration_ms: number;
  model_used: string;
}

/**
 * Function response to send back (with screenshot)
 */
interface FunctionResponseData {
  name: string;
  response: {
    success: boolean;
    error?: string;
  };
  screenshot?: string; // base64 PNG
  url?: string; // Current page URL (required by Gemini Computer Use)
}

/**
 * POST /api/vision/computer-use
 *
 * Get next action from Gemini Computer Use model using native function calling.
 *
 * Request body:
 *   {
 *     image: string,              - base64 encoded PNG screenshot
 *     goal: string,               - what to achieve
 *     previous_actions?: Array<{  - previous function responses
 *       name: string,
 *       response: { success: boolean, error?: string },
 *       screenshot: string        - base64 PNG after action
 *     }>
 *   }
 *
 * Response:
 *   {
 *     completed: boolean,         - true if no more actions needed
 *     function_call?: { name, args, id },
 *     text?: string,              - model's text response
 *     safety_decision?: string,
 *     duration_ms: number,
 *     model_used: string
 *   }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const rateLimitResponse = await checkRateLimit(ip);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = await request.json();
    const { image, goal, previous_actions } = body;

    if (!image) {
      return NextResponse.json(
        { error: 'Missing required field: image' },
        { status: 400 }
      );
    }

    if (!goal) {
      return NextResponse.json(
        { error: 'Missing required field: goal' },
        { status: 400 }
      );
    }

    // Use Google AI API key (not Vertex AI) for Computer Use preview model access
    const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[Computer Use API] GOOGLE_AI_API_KEY or GEMINI_API_KEY not configured');
      return NextResponse.json(
        { error: 'Server configuration error: missing Google AI API key' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenAI({
      apiKey,
    });

    console.log(`[Computer Use API] Calling ${COMPUTER_USE_MODEL} for goal: ${goal.substring(0, 50)}...`);

    // Build contents array - start with user goal + screenshot
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = [
      {
        role: 'user',
        parts: [
          { text: goal },
          {
            inlineData: {
              mimeType: 'image/png',
              data: image,
            },
          },
        ],
      },
    ];

    // If we have previous actions, add them as function responses
    // Only include screenshots for the last 2 actions to avoid payload size issues
    if (previous_actions && Array.isArray(previous_actions)) {
      const actions = previous_actions as FunctionResponseData[];
      const screenshotStartIndex = Math.max(0, actions.length - 2);

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        // Add the model's function call (reconstructed)
        contents.push({
          role: 'model',
          parts: [
            {
              functionCall: {
                name: action.name,
                args: {},
              },
            },
          ],
        });

        // Add user's function response with new screenshot and URL
        // Gemini Computer Use requires URL in function response
        const functionResponseObj: Record<string, unknown> = {
          ...action.response,
        };
        if (action.url) {
          functionResponseObj.url = action.url;
        }

        const responseParts: Record<string, unknown>[] = [
          {
            functionResponse: {
              name: action.name,
              response: functionResponseObj,
            },
          },
        ];

        // Only include screenshots for the last 2 actions to reduce payload size
        if (action.screenshot && i >= screenshotStartIndex) {
          responseParts.push({
            inlineData: {
              mimeType: 'image/png',
              data: action.screenshot,
            },
          });
        }

        contents.push({
          role: 'user',
          parts: responseParts,
        });
      }
    }

    const result = await genAI.models.generateContent({
      model: COMPUTER_USE_MODEL,
      contents,
      config: {
        systemInstruction: `You are a desktop automation agent. After EACH action, examine the screenshot to determine if the goal is achieved.

CRITICAL RULES:
1. If the goal IS achieved (e.g., search results visible after searching, text successfully typed, expected page loaded), respond with text ONLY explaining success. DO NOT call another function.
2. If the goal is NOT yet achieved, call the appropriate function to take the next action.
3. NEVER repeat actions that already succeeded. If you see text was typed correctly, don't retype it.
4. When you see the expected result in the screenshot, the task is COMPLETE - respond with text only.`,
        temperature: 1.0,
        maxOutputTokens: 1024,
        tools: [
          {
            computerUse: {
              // Try UNSPECIFIED to see if it avoids browser-specific requirements
              environment: Environment.ENVIRONMENT_UNSPECIFIED,
              // Exclude browser-specific functions for desktop use
              excludedPredefinedFunctions: ['open_web_browser', 'go_back', 'go_forward'],
            },
          },
        ],
      },
    });

    const duration = Date.now() - startTime;
    const parts = result.candidates?.[0]?.content?.parts || [];

    // Check if model returned any function calls
    const functionCallPart = parts.find((p: { functionCall?: unknown }) => p.functionCall);
    const textPart = parts.find((p: { text?: string }) => p.text);

    // If no function call, task is complete
    if (!functionCallPart?.functionCall) {
      console.log(`[Computer Use API] Task completed in ${duration}ms. Text: ${textPart?.text?.substring(0, 100) || 'none'}`);
      return NextResponse.json({
        completed: true,
        text: textPart?.text,
        duration_ms: duration,
        model_used: COMPUTER_USE_MODEL,
      } as ComputerUseResponse);
    }

    // Extract function call details
    const fc = functionCallPart.functionCall as { name?: string; args?: Record<string, unknown>; id?: string };

    // Check for safety_acknowledgement requirement in args
    const safetyDecision = fc.args?.safety_acknowledgement === false
      ? 'require_confirmation'
      : 'allowed';

    console.log(`[Computer Use API] Action: ${fc.name} in ${duration}ms`);

    return NextResponse.json({
      completed: false,
      function_call: {
        name: fc.name || 'unknown',
        args: fc.args || {},
        id: fc.id,
      },
      text: textPart?.text,
      safety_decision: safetyDecision,
      duration_ms: duration,
      model_used: COMPUTER_USE_MODEL,
    } as ComputerUseResponse);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[Computer Use API] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: duration,
      },
      { status: 500 }
    );
  }
}
