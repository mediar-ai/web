import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getRedisClient } from '@/lib/redis-client';

// Vercel Pro: 5 minute timeout for computer use model
export const maxDuration = 300;

// Rate limits
const RATE_LIMIT_IP_PER_MIN = 100;
const RATE_LIMIT_GLOBAL_PER_MIN = 100;
const RATE_LIMIT_GLOBAL_PER_DAY = 1000;

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
 * History step from previous actions
 */
interface HistoryStep {
  step: number;
  action: string;
  args?: Record<string, unknown>;
  result: 'success' | 'failed';
  error?: string;
}

/**
 * Computer Use action response
 */
interface ComputerUseAction {
  action: string;
  args?: {
    x?: number;
    y?: number;
    text?: string;
    keys?: string;
    direction?: string;
    url?: string;
    start_x?: number;
    start_y?: number;
    end_x?: number;
    end_y?: number;
  };
  reasoning?: string;
  safety_decision?: 'allowed' | 'require_confirmation';
}

/**
 * POST /api/vision/computer-use
 *
 * Get next action from Gemini Computer Use model.
 *
 * Request body:
 *   {
 *     image: string,       - base64 encoded PNG screenshot
 *     goal: string,        - what to achieve
 *     history?: HistoryStep[] - previous actions taken
 *   }
 *
 * Response:
 *   {
 *     action: string,
 *     args?: object,
 *     reasoning?: string,
 *     safety_decision?: string,
 *     duration_ms: number
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
    const { image, goal, history } = body;

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

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.error('[Computer Use API] GOOGLE_APPLICATION_CREDENTIALS_BASE64 not configured');
      return NextResponse.json(
        { error: 'Server configuration error: missing Google credentials' },
        { status: 500 }
      );
    }

    const credentialsJson = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    const genAI = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      location: 'us-central1',
      googleAuthOptions: {
        credentials,
      },
    });

    const modelName = 'gemini-2.0-flash';

    // Build conversation with history context
    let contextPrompt = `You are a desktop automation assistant. Your goal is: ${goal}

You can see a screenshot of the current desktop state. Analyze it and decide the next action to take.

Available actions:
- click_at: Click at coordinates (x, y in 0-999 normalized range)
- type_text_at: Type text at coordinates
- key_combination: Press keyboard keys (e.g., "Enter", "Ctrl+C")
- scroll_document: Scroll the page (direction: "up", "down", "left", "right")
- drag_and_drop: Drag from start to end coordinates
- wait_5_seconds: Wait for UI to update
- done: Goal has been achieved
- cannot_proceed: Cannot complete the goal (explain why in reasoning)

Coordinates are normalized 0-999 where (0,0) is top-left and (999,999) is bottom-right.

For potentially destructive actions (delete, submit, purchase), set safety_decision to "require_confirmation".
`;

    if (history && history.length > 0) {
      contextPrompt += `\n\nPrevious actions taken:\n`;
      for (const step of history as HistoryStep[]) {
        contextPrompt += `- Step ${step.step}: ${step.action}`;
        if (step.args) {
          contextPrompt += ` (${JSON.stringify(step.args)})`;
        }
        contextPrompt += ` -> ${step.result}`;
        if (step.error) {
          contextPrompt += ` (error: ${step.error})`;
        }
        contextPrompt += '\n';
      }
    }

    contextPrompt += `\nAnalyze the screenshot and respond with a JSON object containing:
{
  "action": "action_name",
  "args": { ... },  // action-specific arguments
  "reasoning": "why this action",
  "safety_decision": "allowed" or "require_confirmation"
}`;

    console.log(`[Computer Use API] Calling ${modelName} for goal: ${goal.substring(0, 50)}...`);

    const result = await genAI.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: contextPrompt },
            {
              inlineData: {
                mimeType: 'image/png',
                data: image,
              },
            },
          ],
        },
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    });

    const duration = Date.now() - startTime;
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsedResponse: ComputerUseAction;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[Computer Use API] Failed to parse response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse model response', raw: responseText },
        { status: 500 }
      );
    }

    console.log(`[Computer Use API] Action: ${parsedResponse.action} in ${duration}ms`);

    return NextResponse.json({
      ...parsedResponse,
      duration_ms: duration,
      model_used: modelName,
    });

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
