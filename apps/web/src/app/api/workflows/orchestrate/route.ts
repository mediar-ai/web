import { Function_ } from 'modal';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, model, startDate, endDate, userInstructions } = await request.json();
    
    console.log('🚀 Starting 5-step workflow orchestration via Modal for user:', userId);
    
    // Validate required parameters
    if (!userId || !model || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Set up SSE response
    const encoder = new TextEncoder();
    const toSSE = (data: any) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
    
    const stream = new ReadableStream({
      start(controller) {
        (async () => {
          try {
            // Initial progress update
            controller.enqueue(toSSE({ status: 'Starting 5-step workflow orchestration via Modal...', progress: 0, step: 0 }));
            
            // Use Modal TypeScript SDK to call function by name (NO hardcoded URLs!)
            console.log('🔍 Looking up Modal function: workflow-synthesis-orchestrator::orchestrate_workflow_synthesis');
            controller.enqueue(toSSE({ status: 'Looking up Modal function...', progress: 5, step: 0 }));
            
            // Get the workflow orchestration function by name using Modal JS SDK
            const workflowFn = await Function_.lookup("workflow-synthesis-orchestrator", "orchestrate_workflow_synthesis");
            
            console.log('[SUCCESS] Found Modal function, calling with parameters');
            controller.enqueue(toSSE({ status: 'Calling Modal function...', progress: 10, step: 0 }));
            
            const modalPayload = {
              user_id: userId,
              model,
              start_date: startDate,
              end_date: endDate,
              user_instructions: userInstructions || ""
            };

            console.log('📋 Calling Modal workflow orchestration with payload:', modalPayload);
            controller.enqueue(toSSE({ status: 'Delegating to Modal for long-running orchestration...', progress: 15, step: 0 }));
            
            // Call the function directly using Modal TypeScript SDK
            const result = await workflowFn.remote([], modalPayload);
            
            console.log('[SUCCESS] Modal function completed successfully');
            
            // Process the result
            if (result && typeof result === 'object' && 'success' in result) {
              if (result.success) {
                controller.enqueue(toSSE({ 
                  status: 'Modal workflow orchestration completed successfully!', 
                  progress: 100, 
                  step: 5,
                  result: result 
                }));
              } else {
                controller.enqueue(toSSE({ 
                  error: 'Modal execution failed', 
                  details: result.error || 'Unknown error from Modal', 
                  progress: -1 
                }));
              }
            } else {
              controller.enqueue(toSSE({ 
                status: 'Modal workflow orchestration completed!', 
                progress: 100, 
                step: 5,
                result: result 
              }));
            }

          } catch (error) {
            console.error('[ERROR] Modal orchestration error:', error);
            controller.enqueue(toSSE({ 
              error: 'Modal function call failed', 
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
    console.error('[ERROR] Request processing error:', error);
    return new Response(JSON.stringify({ 
      error: 'Request processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} 