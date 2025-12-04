import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

interface StreamedItem {
  id: string;
  timestamp: string;
  [key: string]: unknown;
}

interface StreamPayload {
  sessionId: string;
  userId: string;
  itemType: 'activity_item' | 'event' | 'log' | 'screenshot_metadata';
  item: StreamedItem;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper function to recursively convert timestamp-like strings to ISO format
function normalizeTimestamps(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    // Check if it looks like a time string (e.g., "11:15:34 AM")
    const timePattern = /^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/i;
    if (timePattern.test(obj)) {
      // Convert to today's date with this time
      const today = new Date();
      const dateStr = `${today.toDateString()} ${obj}`;
      const date = new Date(dateStr);
      return date.toISOString();
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(normalizeTimestamps);
  }
  
  if (typeof obj === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = normalizeTimestamps(value);
    }
    return normalized;
  }
  
  return obj;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as StreamPayload;
    const { sessionId, userId, itemType, item } = payload;

    if (!sessionId || !userId || !itemType || !item || !item.id || !item.timestamp) {
      return NextResponse.json({ error: 'Payload missing required fields (sessionId, userId, itemType, item.id, item.timestamp)' }, { status: 400 });
    }

    await supabaseAdmin.from('users').upsert({ id: userId }, { onConflict: 'id' });
    
    {
        const { id, timestamp, ...item_data } = item;
        
        // Normalize any timestamp-like strings in the item data
        const normalizedItemData = normalizeTimestamps(item_data);
        
        // Ensure the main timestamp is in ISO format
        let clientTimestamp: string;
        try {
          clientTimestamp = new Date(timestamp).toISOString();
        } catch {
          console.error(`[API/STREAM] Invalid timestamp format: ${timestamp}`);
          clientTimestamp = new Date().toISOString(); // Fallback to current time
        }
        
        const { error } = await supabaseAdmin.from('user_activity_data').upsert({
            session_id: sessionId,
            user_id: userId,
            item_type: itemType,
            client_item_id: id,
            item_data: normalizedItemData,
            client_timestamp: clientTimestamp,
            source: 'web',
        }, {
          onConflict: 'session_id, item_type, client_item_id',
        });

        if (error) {
            console.error(`[API/STREAM] Error upserting ${itemType}:`, error);
            return NextResponse.json({ error: `Failed to upsert ${itemType}`, details: error.message }, { status: 500 });
        }
    }
    
    // After successful insert, trigger the metadata update
    // const { error: rpcError } = await supabaseAdmin.rpc('update_session_metadata_from_all_events');
    // if (rpcError) {
    //   console.error('[API/STREAM] Error calling RPC function for session ${sessionId}:', rpcError);
    // }

    return NextResponse.json({ message: `Item ${itemType} streamed successfully` }, { status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/STREAM] Critical error in stream route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 