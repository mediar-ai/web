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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as StreamPayload;
    const { sessionId, userId, itemType, item } = payload;

    if (!sessionId || !userId || !itemType || !item || !item.id || !item.timestamp) {
      return NextResponse.json({ error: 'Payload missing required fields (sessionId, userId, itemType, item.id, item.timestamp)' }, { status: 400 });
    }

    await supabaseAdmin.from('users').upsert({ id: userId }, { onConflict: 'id' });
    
    if (itemType === 'screenshot_metadata') {
        // Type guard for screenshot metadata
        if (typeof item.storage_path === 'string' && typeof item.metadata === 'object' && item.metadata !== null) {
            const { error } = await supabaseAdmin.from('user_activity_data').upsert({
                session_id: sessionId,
                user_id: userId,
                item_type: 'screenshot_metadata',
                client_item_id: item.id,
                item_data: { storage_path: item.storage_path, ...(item.metadata as Record<string, unknown>) },
                client_timestamp: new Date(item.timestamp).toISOString(),
            }, {
              onConflict: 'session_id, item_type, client_item_id',
            });

            if (error) {
                console.error(`[API/STREAM] Error upserting screenshot metadata:`, error);
                return NextResponse.json({ error: 'Failed to upsert screenshot metadata', details: error.message }, { status: 500 });
            }
        } else {
            return NextResponse.json({ error: 'Invalid screenshot metadata item' }, { status: 400 });
        }
    } else {
        const { id, timestamp, ...item_data } = item;
        const { error } = await supabaseAdmin.from('user_activity_data').upsert({
            session_id: sessionId,
            user_id: userId,
            item_type: itemType,
            client_item_id: id,
            item_data: item_data,
            client_timestamp: timestamp,
        }, {
          onConflict: 'session_id, item_type, client_item_id',
        });

        if (error) {
            console.error(`[API/STREAM] Error upserting ${itemType}:`, error);
            return NextResponse.json({ error: `Failed to upsert ${itemType}`, details: error.message }, { status: 500 });
        }
    }
    
    return NextResponse.json({ message: `Item ${itemType} streamed successfully` }, { status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/STREAM] Critical error in stream route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 