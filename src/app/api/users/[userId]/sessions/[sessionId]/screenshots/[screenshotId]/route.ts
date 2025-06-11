import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface Params {
  params: Promise<{
    userId: string;
    sessionId: string;
    screenshotId: string;
  }>;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { userId, sessionId, screenshotId } = await params;
    
    console.log(`[API] Fetching screenshot ${screenshotId} for user ${userId}, session ${sessionId}`);
    
    // First, fetch the screenshot metadata to get the storage path
    const { data: metadata, error: metadataError } = await supabaseAdmin
      .from('user_activity_data')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('item_type', 'screenshot_metadata')
      .eq('client_item_id', screenshotId)
      .single();

    if (metadataError || !metadata) {
      console.error('[API] Screenshot metadata not found:', metadataError);
      return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 });
    }

    const storagePath = metadata.item_data.storage_path;
    
    if (!storagePath) {
      console.error('[API] No storage path in metadata');
      return NextResponse.json({ error: 'Screenshot storage path not found' }, { status: 404 });
    }

    // Generate a public URL for the screenshot
    // For now, we'll return the storage path. In a real implementation,
    // this would generate a signed URL from Supabase Storage
    const { data: urlData } = supabaseAdmin.storage
      .from('screenshots')
      .getPublicUrl(storagePath);

    console.log(`[API] Generated URL for screenshot ${screenshotId}`);

    return NextResponse.json({ 
      url: urlData.publicUrl,
      metadata: metadata.item_data 
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API] Critical error in screenshot route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 