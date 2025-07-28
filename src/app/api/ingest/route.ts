import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper function to create consistent hash regardless of JSON key order
function createConsistentHash(obj: Record<string, unknown>): string {
  return createHash('md5')
    .update(JSON.stringify(obj, Object.keys(obj).sort()))
    .digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    console.log(`[INGEST] Processing event for session ${session_id}`);

    // 🛡️ LIGHTWEIGHT DUPLICATE PREVENTION
    // Generate consistent hash regardless of JSON property order
    const payloadHash = createConsistentHash(body);

    console.log(`[INGEST] Request hash: ${payloadHash.substring(0, 8)}...`);

    // Check for identical events in the last 30 seconds based on SERVER TIME
    // Using created_at which defaults to now() for recent event detection
    const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
    
    const { data: recentEvents, error: checkError } = await supabaseAdmin
      .from('low_level_events')
      .select('id, payload')
      .eq('user_id', user_id)
      .eq('session_id', session_id)
      .gte('created_at', thirtySecondsAgo)  // Server time comparison
      .limit(5); // Only check last 5 events for performance

    if (checkError) {
      console.warn('[INGEST] Deduplication check failed, proceeding with insert:', checkError);
    } else if (recentEvents && recentEvents.length > 0) {
      console.log(`[INGEST] Checking ${recentEvents.length} recent events for duplicates...`);
      
      // Check if any recent event has identical payload
      for (const recentEvent of recentEvents) {
        // Generate consistent hash for stored payload
        const recentPayloadHash = createConsistentHash(recentEvent.payload);
        
        console.log(`[INGEST] Comparing with event ${recentEvent.id}, hash: ${recentPayloadHash.substring(0, 8)}...`);
        
        if (recentPayloadHash === payloadHash) {
          console.log(`[INGEST] 🚫 Duplicate detected for session ${session_id} - payload hash: ${payloadHash.substring(0, 8)}...`);
          return NextResponse.json({ 
            message: "Duplicate event suppressed",
            dbInsertSuccess: false
          });
        }
      }
      
      console.log(`[INGEST] No duplicates found among ${recentEvents.length} recent events`);
    } else {
      console.log(`[INGEST] No recent events found for deduplication check`);
    }

    // No duplicates found, proceed with normal insert
    // Let created_at default to now() for proper server-time based deduplication
    const { error } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id,
        payload: body,  // Store entire request body including client timestamp
        source: 'windows_app'
        // created_at will default to now() - perfect for deduplication timing
      });

    if (error) {
      console.error('[INGEST] Error saving raw event:', error);
      return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
    }

    console.log(`[INGEST] ✅ Successfully saved raw event for session ${session_id}`);

    return NextResponse.json({ 
      message: "Event ingested successfully",
      dbInsertSuccess: true 
    });
  } catch (error) {
    console.error('[INGEST] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
