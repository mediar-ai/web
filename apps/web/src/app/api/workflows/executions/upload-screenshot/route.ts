import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const uploadSchema = z.object({
  execution_id: z.string().min(1),
  monitor_index: z.number().int().min(0),
  base64_data: z.string().min(1),
});

/**
 * POST /api/workflows/executions/upload-screenshot
 * Uploads a screenshot from workflow execution to Supabase Storage
 *
 * Request body:
 * {
 *   execution_id: string,
 *   monitor_index: number,
 *   base64_data: string  // Base64-encoded PNG data
 * }
 *
 * Returns:
 * {
 *   success: true,
 *   url: string  // Public URL to the uploaded screenshot
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = uploadSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { execution_id, monitor_index, base64_data } = validation.data;

    // Decode base64 to binary
    const buffer = Buffer.from(base64_data, 'base64');

    // Generate storage path: workflow-screenshots/{execution_id}/monitor_{index}.png
    const path = `workflow-screenshots/${execution_id}/monitor_${monitor_index + 1}.png`;

    // Upload to Supabase Storage
    const { data, error } = await getSupabaseAdmin().storage
      .from('workflow-screenshots')
      .upload(path, buffer, {
        contentType: 'image/png',
        upsert: true, // Allow overwriting if exists
      });

    if (error) {
      console.error('[API/upload-screenshot] Supabase upload error:', error);
      return NextResponse.json(
        { error: 'Failed to upload screenshot', details: error.message },
        { status: 500 }
      );
    }

    // Get public URL for the uploaded file
    const { data: urlData } = getSupabaseAdmin().storage
      .from('workflow-screenshots')
      .getPublicUrl(path);

    return NextResponse.json(
      {
        success: true,
        url: urlData.publicUrl,
        path: data.path,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/upload-screenshot] Critical error:', error);
    return NextResponse.json(
      { error: 'Failed to process upload', details: errorMessage },
      { status: 500 }
    );
  }
}
