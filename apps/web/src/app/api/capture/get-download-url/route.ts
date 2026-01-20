import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const downloadUrlSchema = z.object({
  path: z.string().min(1, { message: "Path is required" }),
});

// This policy allows any authenticated user to download files
// but ONLY from a folder that matches their own user ID.
//
// CREATE POLICY "Allow authenticated downloads"
// ON storage.objects FOR SELECT
// TO authenticated
// USING (
//   bucket_id = 'low-level-event-screenshots'
//   AND (storage.foldername(name))[1] = auth.uid()::text
// );
//
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = downloadUrlSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: validation.error.flatten() }, { status: 400 });
    }
    
    const { path } = validation.data;
    
    // Generate a signed URL that's valid for 10 minutes.
    // This provides temporary, secure access to the private file.
    const { data, error } = await getSupabaseAdmin().storage
      .from('low-level-event-screenshots')
      .createSignedUrl(path, 600); // 10 minutes = 600 seconds

    if (error) {
      console.error('[API/get-download-url] Supabase error:', error);
      return NextResponse.json({ error: 'Failed to create signed URL', details: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/get-download-url] Critical error:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 