import { NextRequest, NextResponse } from 'next/server';

// Vercel Pro: 5 minute timeout for long-running predictions
export const maxDuration = 300;

interface OmniparserElement {
  type: 'text' | 'icon';
  bbox: [number, number, number, number]; // normalized 0-1 [x1, y1, x2, y2]
  interactivity: boolean;
  content: string;
}

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: {
    elements?: string;
    img?: string;
  };
  error?: string;
  urls?: {
    get: string;
    cancel: string;
  };
}

/**
 * Parse OmniParser output string into structured elements
 * Format: "icon 0: {'type': 'text', 'bbox': [...], ...}\nicon 1: {...}"
 */
function parseOmniparserOutput(elementsStr: string): OmniparserElement[] {
  const elements: OmniparserElement[] = [];

  // Match each "icon N: {...}" entry
  const pattern = /icon \d+: (\{[^}]+\})/g;
  let match;

  while ((match = pattern.exec(elementsStr)) !== null) {
    try {
      // Convert Python dict syntax to JSON (single quotes to double quotes)
      const jsonStr = match[1]
        .replace(/'/g, '"')
        .replace(/True/g, 'true')
        .replace(/False/g, 'false');

      const elem = JSON.parse(jsonStr);

      elements.push({
        type: elem.type || 'icon',
        bbox: elem.bbox || [0, 0, 0, 0],
        interactivity: elem.interactivity || false,
        content: elem.content || '',
      });
    } catch {
      // Skip malformed entries
      console.warn('Failed to parse element:', match[1]);
    }
  }

  return elements;
}

/**
 * POST /api/omniparser/parse
 *
 * Parse a screenshot using Microsoft OmniParser v2 model via Replicate.
 * Returns detected UI elements (text and icons) with bounding boxes.
 *
 * Request body:
 *   {
 *     image: string,    - base64 encoded PNG image
 *     imgsz?: number    - icon detection image size (640-1920, default 1920)
 *   }
 *
 * Response:
 *   {
 *     elements: OmniparserElement[],
 *     annotated_image_url?: string,
 *     prediction_id: string
 *   }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { image, imgsz } = body;

    if (!image) {
      return NextResponse.json(
        { error: 'Missing required field: image (base64 encoded)' },
        { status: 400 }
      );
    }

    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) {
      console.error('REPLICATE_API_TOKEN not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // OmniParser v2 model version
    const VERSION = '49cf3d41b8d3aca1360514e83be4c97131ce8f0d99abfc365526d8384caa88df';

    // Validate and clamp imgsz (640-1920, default 1920 for best detection)
    const imgszValue = Math.min(1920, Math.max(640, imgsz || 1920));

    // Create prediction
    console.log(`[OmniParser] Creating prediction with imgsz=${imgszValue}...`);
    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: VERSION,
        input: {
          image: `data:image/png;base64,${image}`,
          imgsz: imgszValue,
        },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[OmniParser] Failed to create prediction:', errorText);
      return NextResponse.json(
        { error: `Replicate API error: ${createResponse.status}` },
        { status: 502 }
      );
    }

    let prediction: ReplicatePrediction = await createResponse.json();
    console.log(`[OmniParser] Prediction created: ${prediction.id}, status: ${prediction.status}`);

    // Poll for completion
    const maxPollTime = 280000; // 280 seconds (leave buffer for response)
    const pollInterval = 2000; // 2 seconds
    let pollCount = 0;

    while (
      (prediction.status === 'starting' || prediction.status === 'processing') &&
      Date.now() - startTime < maxPollTime
    ) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      pollCount++;

      if (!prediction.urls?.get) {
        console.error('[OmniParser] No poll URL available');
        break;
      }

      const pollResponse = await fetch(prediction.urls.get, {
        headers: {
          'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        },
      });

      if (!pollResponse.ok) {
        console.error('[OmniParser] Poll failed:', pollResponse.status);
        continue;
      }

      prediction = await pollResponse.json();

      if (pollCount % 10 === 0) {
        console.log(`[OmniParser] Poll #${pollCount}, status: ${prediction.status}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[OmniParser] Completed in ${duration}ms, status: ${prediction.status}`);

    // Handle final status
    if (prediction.status === 'failed') {
      return NextResponse.json(
        { error: prediction.error || 'Prediction failed', prediction_id: prediction.id },
        { status: 500 }
      );
    }

    if (prediction.status === 'canceled') {
      return NextResponse.json(
        { error: 'Prediction was canceled', prediction_id: prediction.id },
        { status: 500 }
      );
    }

    if (prediction.status !== 'succeeded') {
      return NextResponse.json(
        { error: `Prediction timed out (status: ${prediction.status})`, prediction_id: prediction.id },
        { status: 504 }
      );
    }

    // Parse output
    const elementsStr = prediction.output?.elements || '';
    const elements = parseOmniparserOutput(elementsStr);

    console.log(`[OmniParser] Parsed ${elements.length} elements`);

    return NextResponse.json({
      elements,
      annotated_image_url: prediction.output?.img,
      prediction_id: prediction.id,
      duration_ms: duration,
    });

  } catch (error) {
    console.error('[OmniParser] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
