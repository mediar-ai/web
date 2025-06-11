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
  }>;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { userId, sessionId } = await params;
    
    console.log(`[API] Fetching screenshot metadata for user ${userId}, session ${sessionId}`);
    
    // Fetch screenshot metadata from Supabase
    const { data, error } = await supabaseAdmin
      .from('user_activity_data')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('item_type', 'screenshot_metadata')
      .order('client_timestamp', { ascending: false });

    if (error) {
      console.error('[API] Error fetching screenshot metadata:', error);
      return NextResponse.json({ error: 'Failed to fetch screenshot metadata', details: error.message }, { status: 500 });
    }

    // Extract the screenshot metadata
    const screenshots = data?.map(row => ({
      id: row.client_item_id,
      storage_path: row.item_data.storage_path,
      metadata: row.item_data,
      timestamp: row.client_timestamp
    })) || [];

    console.log(`[API] Found ${screenshots.length} screenshots for session ${sessionId}`);

    return NextResponse.json(screenshots);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API] Critical error in screenshots route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 