import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getRedisClient } from '@/lib/redis-client';

// Vercel Pro: 5 minute timeout for vision model
export const maxDuration = 300;

// Rate limits
const RATE_LIMIT_IP_PER_MIN = 10;
const RATE_LIMIT_GLOBAL_PER_MIN = 100;
const RATE_LIMIT_GLOBAL_PER_DAY = 1000;

/**
 * Check rate limits using Redis
 * Returns null if allowed, or error response if rate limited
 */
async function checkRateLimit(ip: string): Promise<NextResponse | null> {
  try {
    const redis = await getRedisClient();
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const currentDay = Math.floor(now / 86400000);

    const ipKey = `vision:ip:${ip}:${currentMinute}`;
    const globalMinKey = `vision:global:min:${currentMinute}`;
    const globalDayKey = `vision:global:day:${currentDay}`;

    // Check all limits in parallel
    const [ipCount, globalMinCount, globalDayCount] = await Promise.all([
      redis.incr(ipKey),
      redis.incr(globalMinKey),
      redis.incr(globalDayKey),
    ]);

    // Set expiry on first increment (TTL: 2 min for minute keys, 25 hours for day key)
    if (ipCount === 1) await redis.expire(ipKey, 120);
    if (globalMinCount === 1) await redis.expire(globalMinKey, 120);
    if (globalDayCount === 1) await redis.expire(globalDayKey, 90000);

    // Check limits
    if (ipCount > RATE_LIMIT_IP_PER_MIN) {
      console.log(`[Vision API] Rate limit exceeded for IP ${ip}: ${ipCount}/${RATE_LIMIT_IP_PER_MIN} per minute`);
      return NextResponse.json(
        { error: 'Rate limit exceeded: max 10 requests per minute per IP' },
        { status: 429 }
      );
    }

    if (globalMinCount > RATE_LIMIT_GLOBAL_PER_MIN) {
      console.log(`[Vision API] Global rate limit exceeded: ${globalMinCount}/${RATE_LIMIT_GLOBAL_PER_MIN} per minute`);
      return NextResponse.json(
        { error: 'Rate limit exceeded: service is busy, try again later' },
        { status: 429 }
      );
    }

    if (globalDayCount > RATE_LIMIT_GLOBAL_PER_DAY) {
      console.log(`[Vision API] Daily rate limit exceeded: ${globalDayCount}/${RATE_LIMIT_GLOBAL_PER_DAY} per day`);
      return NextResponse.json(
        { error: 'Rate limit exceeded: daily limit reached, try again tomorrow' },
        { status: 429 }
      );
    }

    return null; // All limits OK
  } catch (error) {
    // If Redis fails, log and allow the request (fail open)
    console.error('[Vision API] Rate limit check failed:', error);
    return null;
  }
}

/**
 * Vision element detected by AI vision model
 */
interface VisionElement {
  type: 'text' | 'icon' | 'button' | 'input' | 'checkbox' | 'dropdown' | 'link' | 'image' | 'unknown';
  bbox: [number, number, number, number]; // normalized 0-1 [x1, y1, x2, y2]
  interactivity?: boolean;
  content: string;      // visible text/label
  description: string;  // AI description of what element does
}

/**
 * Response schema for Gemini structured output
 */
const VISION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['text', 'icon', 'button', 'input', 'checkbox', 'dropdown', 'link', 'image', 'unknown'],
            description: 'Type of UI element'
          },
          bbox: {
            type: 'array',
            items: { type: 'number' },
            minItems: 4,
            maxItems: 4,
            description: 'Bounding box as [x1, y1, x2, y2] normalized 0-1 coordinates'
          },
          interactivity: {
            type: 'boolean',
            description: 'Whether the element is interactive/clickable'
          },
          content: {
            type: 'string',
            description: 'Visible text or label on the element'
          },
          description: {
            type: 'string',
            description: 'Brief description of what this element is or does'
          }
        },
        required: ['type', 'bbox', 'content', 'description']
      }
    }
  },
  required: ['elements']
};

const DEFAULT_VISION_PROMPT = `You are a UI element detector. Analyze this screenshot and identify ALL interactive and important UI elements.

For EACH element, provide:
- type: The element type (button, input, checkbox, dropdown, link, icon, text, image, or unknown)
- bbox: Bounding box as [x1, y1, x2, y2] where values are normalized 0-1 (0,0 is top-left, 1,1 is bottom-right)
- content: Any visible text on/in the element (empty string if none)
- description: Brief description of what this element is or does
- interactivity: true if clickable/interactive, false otherwise (omit if unsure)

Focus on:
1. Buttons, links, and clickable elements
2. Input fields, textareas, dropdowns
3. Checkboxes, radio buttons, toggles
4. Icons that appear clickable
5. Important text labels and headings
6. Navigation elements

Be thorough - detect ALL UI elements visible in the screenshot. Be precise with bounding boxes.`;

/**
 * POST /api/vision/parse
 *
 * Parse a screenshot using Gemini vision model to detect UI elements.
 * Returns detected elements with bounding boxes in the same format as omniparser.
 *
 * Request body:
 *   {
 *     image: string,    - base64 encoded PNG image
 *     model?: string    - "gemini" (default)
 *   }
 *
 * Response:
 *   {
 *     elements: VisionElement[],
 *     duration_ms: number,
 *     model_used: string
 *   }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Get client IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  // Check rate limits
  const rateLimitResponse = await checkRateLimit(ip);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const body = await request.json();
    const { image, model = 'gemini', prompt } = body;
    const visionPrompt = prompt || DEFAULT_VISION_PROMPT;

    if (!image) {
      return NextResponse.json(
        { error: 'Missing required field: image (base64 encoded)' },
        { status: 400 }
      );
    }

    if (model !== 'gemini') {
      return NextResponse.json(
        { error: `Unsupported model: ${model}. Currently only 'gemini' is supported.` },
        { status: 400 }
      );
    }

    // Check for credentials
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      console.error('[Vision API] GOOGLE_APPLICATION_CREDENTIALS_BASE64 not configured');
      return NextResponse.json(
        { error: 'Server configuration error: missing Google credentials' },
        { status: 500 }
      );
    }

    // Initialize Gemini
    const credentialsJson = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64,
      'base64'
    ).toString('utf-8');
    const credentials = JSON.parse(credentialsJson);

    const genAI = new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      location: 'global', // Gemini 3 requires global endpoint
      googleAuthOptions: {
        credentials,
      },
    });

    // Use Gemini 3 Pro Preview for quality vision detection
    const modelName = 'gemini-3-pro-preview';

    console.log(`[Vision API] Calling ${modelName} for UI element detection...`);

    const result = await genAI.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: visionPrompt },
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
        temperature: 0.1, // Low temperature for consistent detection
        maxOutputTokens: 32768, // Vertex AI max for Gemini 3 Pro Preview
        responseMimeType: 'application/json',
        responseSchema: VISION_RESPONSE_SCHEMA,
      },
    });

    const duration = Date.now() - startTime;

    // Check finish reason for truncation
    const finishReason = result.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[Vision API] Response truncated or blocked: finishReason=${finishReason}`);
      if (finishReason === 'MAX_TOKENS') {
        console.error('[Vision API] Output exceeded token limit - response truncated');
      } else if (finishReason === 'SAFETY') {
        return NextResponse.json(
          { error: 'Response blocked by safety filters', finishReason },
          { status: 400 }
        );
      }
    }

    // Parse response - SDK returns response directly
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsedResponse: { elements?: VisionElement[] };
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[Vision API] Failed to parse Gemini response:', responseText?.slice(0, 500));
      return NextResponse.json(
        {
          error: 'Failed to parse model response',
          finishReason: finishReason || 'unknown',
          hint: finishReason === 'MAX_TOKENS' ? 'Response was truncated due to token limit' : undefined,
        },
        { status: 500 }
      );
    }

    const elements = parsedResponse.elements || [];

    console.log(`[Vision API] Detected ${elements.length} elements in ${duration}ms`);

    return NextResponse.json({
      elements,
      duration_ms: duration,
      model_used: modelName,
      ...(finishReason && finishReason !== 'STOP' && { finishReason, warning: 'Response may be incomplete' }),
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('[Vision API] Error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: duration,
      },
      { status: 500 }
    );
  }
}
