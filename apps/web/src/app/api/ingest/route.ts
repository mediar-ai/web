import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper function to extract UI tree from payload structure
function extractUITree(payload: any): string | null {
  // Try different payload structures
  if (payload?.payload?.event?.screen?.ui_tree) {
    return payload.payload.event.screen.ui_tree;
  } else if (payload?.event?.screen?.ui_tree) {
    return payload.event.screen.ui_tree;
  }
  return null;
}

// Helper function to create UI tree duplicate hash
function createUITreeHash(uiTree: string, clientTimestamp: string, userId: string, sessionId: string): string {
  return createHash('md5')
    .update(`${userId}:${sessionId}:${clientTimestamp}:${uiTree}`)
    .digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    // Extract and validate Authorization header
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[INGEST] Missing or invalid Authorization header');
      return NextResponse.json(
        { error: 'Unauthorized - Missing authentication token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate token
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      console.log('[INGEST] Token validation failed:', validation.error);
      return NextResponse.json(
        { error: `Unauthorized - ${validation.error}` },
        { status: 401 }
      );
    }

    console.log(`[INGEST] Authenticated request from user: ${validation.email}`);

    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    // Verify user_id matches token (if user_id is provided)
    if (user_id && user_id !== validation.userId) {
      console.log(`[INGEST] user_id mismatch - token: ${validation.userId}, payload: ${user_id}`);
      return NextResponse.json(
        { error: 'Unauthorized - user_id does not match authentication token' },
        { status: 403 }
      );
    }

    console.log(`[INGEST] Processing event for session ${session_id}, type: ${payload.type}`);

    // [PROTECTION] TARGETED UI TREE DUPLICATE PREVENTION
    // Only apply duplicate detection to UI tree events (meaningful_event)
    if (payload.type === 'meaningful_event') {
      const uiTree = extractUITree(payload);
      const clientTimestamp = payload.timestamp;

      if (uiTree && clientTimestamp) {
        // Create targeted hash: UI tree + client timestamp + context
        const uiTreeHash = createUITreeHash(uiTree, clientTimestamp, user_id, session_id);
        
        console.log(`[INGEST] UI tree event - hash: ${uiTreeHash.substring(0, 8)}..., timestamp: ${clientTimestamp}`);

        // Check for identical UI tree + timestamp combinations in recent events
        // Use a shorter 10-second window for UI tree duplicates since we're matching exact timestamps
        const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
        
        const { data: recentEvents, error: checkError } = await supabaseAdmin
          .from('low_level_events')
          .select('id, payload')
          .eq('user_id', user_id)
          .eq('session_id', session_id)
          .gte('created_at', tenSecondsAgo)
          .limit(10); // Check more events since we're being more specific

        if (checkError) {
          console.warn('[INGEST] UI tree deduplication check failed, proceeding with insert:', checkError);
        } else if (recentEvents && recentEvents.length > 0) {
          console.log(`[INGEST] Checking ${recentEvents.length} recent events for UI tree duplicates...`);
          
          // Check if any recent event has identical UI tree + timestamp
          for (const recentEvent of recentEvents) {
            const recentPayload = recentEvent.payload as any;
            
            // Only compare with other UI tree events
            if (recentPayload?.type === 'meaningful_event') {
              const recentUITree = extractUITree(recentPayload);
              const recentClientTimestamp = recentPayload?.timestamp;
              
              if (recentUITree && recentClientTimestamp) {
                const recentUITreeHash = createUITreeHash(recentUITree, recentClientTimestamp, user_id, session_id);
                
                console.log(`[INGEST] Comparing UI tree with event ${recentEvent.id}, hash: ${recentUITreeHash.substring(0, 8)}...`);
                
                if (recentUITreeHash === uiTreeHash) {
                  console.log(`[INGEST] 🚫 UI tree duplicate detected for session ${session_id} - UI tree + timestamp hash: ${uiTreeHash.substring(0, 8)}...`);
                  return NextResponse.json({ 
                    message: "Duplicate UI tree event suppressed (identical UI tree + client timestamp)",
                    dbInsertSuccess: false
                  });
                }
              }
            }
          }
          
          console.log(`[INGEST] No UI tree duplicates found among ${recentEvents.length} recent events`);
        } else {
          console.log(`[INGEST] No recent events found for UI tree deduplication check`);
        }
      } else {
        console.log(`[INGEST] UI tree event missing ui_tree or timestamp - skipping duplicate check`);
      }
    } else {
      console.log(`[INGEST] Non-UI tree event (${payload.type}) - no duplicate detection applied`);
    }

    // No duplicates found, proceed with normal insert
    // Handle Clerk user IDs vs UUID user IDs
    let userIdForDB = null;
    let payloadToStore = body;

    if (user_id) {
      // Check if it's a valid UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(user_id)) {
        // It's a valid UUID, use it directly
        userIdForDB = user_id;
      } else {
        // It's a Clerk user ID or other format
        // Store the Clerk ID in the payload and use NULL for the UUID column
        console.log(`[INGEST] Non-UUID user_id detected (${user_id}), storing in payload.clerk_user_id`);
        userIdForDB = null;

        // Ensure the Clerk user_id is preserved in the payload
        payloadToStore = {
          ...body,
          clerk_user_id: user_id  // Preserve Clerk user ID in the payload
        };
      }
    }

    const { error } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id: userIdForDB,  // Use the processed user_id (UUID or NULL)
        payload: payloadToStore,  // Store entire request body including clerk_user_id if needed
        source: 'windows_app'
        // created_at will default to now() for proper server-time based queries
      });

    if (error) {
      console.error('[INGEST] Error saving raw event:', error);
      return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
    }

    console.log(`[INGEST] [SUCCESS] Successfully saved ${payload.type} event for session ${session_id}`);
    return NextResponse.json({ message: 'Event ingested successfully', dbInsertSuccess: true });

  } catch (error) {
    console.error('[INGEST] Error processing request:', error);
    return NextResponse.json({ error: 'Failed to process event' }, { status: 500 });
  }
}
