import { Function_ } from 'modal';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    // Validate auth token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      return new Response(JSON.stringify({ error: `Unauthorized - ${validation.error}` }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { sessionId } = await params;
    const { userId, model = 'gemini-2.5-pro' } = await request.json();

    if (!sessionId || !userId) {
      return new Response(JSON.stringify({ error: 'sessionId and userId are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`[recording/synthesize] Starting synthesis for session ${sessionId}, user ${userId}`);

    // Get session timestamps for boundaries
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('session_metadata')
      .select('first_event_timestamp, last_event_timestamp, stopped')
      .eq('session_id', sessionId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!session.first_event_timestamp || !session.last_event_timestamp) {
      return new Response(JSON.stringify({ error: 'Session timestamps not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify processing is complete
    const { data: pendingCount } = await supabaseAdmin
      .rpc('count_unprocessed_events_by_timestamp', { p_user_id: userId });

    if ((pendingCount || 0) > 0) {
      return new Response(JSON.stringify({
        error: 'Processing not complete',
        pendingCount,
        message: `${pendingCount} events still being processed. Please wait.`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Mark session as synthesizing
    await supabaseAdmin
      .from('session_metadata')
      .update({ synthesizing: true })
      .eq('session_id', sessionId);

    // Set up SSE stream
    const encoder = new TextEncoder();
    const toSSE = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

    const stream = new ReadableStream({
      start(controller) {
        (async () => {
          try {
            controller.enqueue(toSSE({
              status: 'Starting workflow synthesis...',
              progress: 0,
              step: 0
            }));

            console.log('[recording/synthesize] Looking up Modal function...');
            const synthesisFn = await Function_.lookup(
              "workflow-synthesis-orchestrator",
              "orchestrate_workflow_synthesis"
            );

            controller.enqueue(toSSE({
              status: 'Calling Modal synthesis orchestrator...',
              progress: 10,
              step: 1
            }));

            console.log('[recording/synthesize] Calling Modal with timestamps:', {
              start: session.first_event_timestamp,
              end: session.last_event_timestamp
            });

            const result = await synthesisFn.remote([], {
              user_id: userId,
              model,
              start_date: session.first_event_timestamp,
              end_date: session.last_event_timestamp,
              user_instructions: ""
            });

            console.log('[recording/synthesize] Modal synthesis completed');

            // Auto-save synthesis result to database
            let savedSynthesisId = null;
            if (result && result.success && result.final_data) {
              console.log('[recording/synthesize] Auto-saving synthesis to database...');

              const synthesisTitle = `Recording ${sessionId.substring(0, 8)} - ${new Date().toLocaleDateString()}`;

              const { data: savedSynthesis, error: saveError } = await supabaseAdmin
                .from('saved_workflow_syntheses')
                .insert({
                  user_id: userId,
                  title: synthesisTitle,
                  description: `Auto-generated from recording session ${sessionId}`,
                  workflow_context: result.final_data.workflowContext || null,
                  identified_workflow_names: result.final_data.identifiedWorkflowNames || [],
                  workflow_boundaries: result.final_data.workflowBoundaries || {},
                  synthesis_results: result.final_data.synthesizedWorkflows || [],
                  synthesis_process_data: {
                    session_id: sessionId,
                    start_date: session.first_event_timestamp,
                    end_date: session.last_event_timestamp,
                    step_results: result.step_results || {},
                    timeline_annotations: result.final_data.timelineAnnotations || []
                  },
                  models_used: [model],
                  synthesis_duration_seconds: result.duration_seconds || null,
                  synthesis_started_at: result.start_time || new Date().toISOString(),
                  synthesis_completed_at: new Date().toISOString(),
                  is_active: true,
                  version: 1
                })
                .select('id')
                .single();

              if (saveError) {
                console.error('[recording/synthesize] Failed to auto-save synthesis:', saveError);
              } else {
                savedSynthesisId = savedSynthesis?.id;
                console.log('[recording/synthesize] Synthesis auto-saved with ID:', savedSynthesisId);
              }
            }

            // Mark session as complete
            await supabaseAdmin
              .from('session_metadata')
              .update({
                synthesizing: false,
                synthesis_complete: true
              })
              .eq('session_id', sessionId);

            controller.enqueue(toSSE({
              status: 'Synthesis complete!',
              progress: 100,
              step: 5,
              result,
              savedSynthesisId
            }));

          } catch (error) {
            console.error('[recording/synthesize] Error:', error);

            // Mark session as not synthesizing on error
            await supabaseAdmin
              .from('session_metadata')
              .update({ synthesizing: false })
              .eq('session_id', sessionId);

            controller.enqueue(toSSE({
              error: 'Synthesis failed',
              details: error instanceof Error ? error.message : 'Unknown error',
              progress: -1
            }));
          } finally {
            controller.close();
          }
        })();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('[recording/synthesize] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(JSON.stringify({ error: 'Internal server error', details: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
