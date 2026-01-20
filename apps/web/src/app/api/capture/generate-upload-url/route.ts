import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const uploadUrlSchema = z.object({
  path: z.string().min(1, { message: "Path is required" }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = uploadUrlSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: validation.error.flatten() }, { status: 400 });
    }
    
    const { path } = validation.data;

    // The RLS policy we created in Supabase will enforce that a user can only
    // get a URL for a path that starts with their own user ID.
    const { data, error } = await getSupabaseAdmin().storage
      .from('low-level-event-screenshots')
      .createSignedUploadUrl(path);

    if (error) {
      console.error('[API/generate-upload-url] Supabase error:', error);
      return NextResponse.json({ error: 'Failed to create signed URL', details: error.message }, { status: 500 });
    }

    // Return the signed URL to the client.
    // data contains { path, token, signedUrl } - we return signedUrl for direct upload
    return NextResponse.json({ signedUrl: data.signedUrl }, { status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/generate-upload-url] Critical error:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 