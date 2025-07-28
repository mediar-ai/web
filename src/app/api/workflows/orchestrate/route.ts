import { NextRequest, NextResponse } from 'next/server';

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  try {
    const { userId, model, startDate, endDate, userInstructions } = await req.json();

    if (!userId || !model) {
      return NextResponse.json({ error: 'Missing required parameters: userId and model' }, { status: 400 });
    }

    console.log('🚀 Starting 5-step workflow orchestration via Modal for user:', userId);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(toSSE({ status: 'Starting 5-step workflow orchestration via Modal...', progress: 0, step: 0 }));

          // Call Modal function for orchestration (with 3-hour timeout instead of Vercel's 10-minute limit)
          console.log('Modal parameters ready:', { userId, model, startDate, endDate, userInstructions });
          controller.enqueue(toSSE({ status: 'Delegating to Modal for long-running orchestration...', progress: 5, step: 0 }));
          
          // Call Modal function directly using the deployed function
          const modalUrl = 'https://mediar-ai--workflow-synthesis-orchestrator-orchestrate-workflow-synthesis.modal.run';
          
          const modalPayload = {
            user_id: userId,
            model,
            start_date: startDate,
            end_date: endDate,
            user_instructions: userInstructions || ''
          };

          const modalResponse = await fetch(modalUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(modalPayload),
            signal: AbortSignal.timeout(600000) // 10 minute timeout for Vercel
          });

          if (!modalResponse.ok) {
            throw new Error(`Modal function failed: ${modalResponse.status} ${modalResponse.statusText}`);
          }

          const modalResult = await modalResponse.json();

          if (modalResult.success) {
            const finalData = modalResult.final_data || {};
            controller.enqueue(toSSE({ 
              status: 'All 5 steps completed successfully via Modal!', 
              progress: 100, 
              step: 5,
              data: finalData,
              success: true
            }));
          } else {
            throw new Error(modalResult.error || 'Modal orchestration failed');
          }

          console.log('ℹ️ Modal orchestration endpoint ready for deployment');

        } catch (error) {
          console.error('❌ Orchestration failed:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown orchestration error';
          controller.enqueue(toSSE({ 
            error: 'Orchestration failed', 
            details: errorMessage,
            progress: -1
          }));
        } finally {
          controller.close();
        }
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
    console.error('❌ Failed to start orchestration:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to start orchestration', details: errorMessage }, { status: 500 });
  }
} 