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

    console.log('🚀 Starting 5-step workflow orchestration for user:', userId);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(toSSE({ status: 'Starting 5-step workflow orchestration...', progress: 0, step: 0 }));

          // Common request options
          const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
          const requestOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          };

          // Step 1: Analyze Context & Draft Workflows
          controller.enqueue(toSSE({ status: 'Step 1/5: Analyzing context and drafting workflows...', progress: 10, step: 1 }));
          
          const step1Response = await fetch(`${baseUrl}/api/initiate-workflow-analysis`, {
            ...requestOptions,
            body: JSON.stringify({
              userId,
              model,
              ...(startDate && endDate && { startDate, endDate })
            })
          });

          if (!step1Response.ok) {
            throw new Error(`Step 1 failed: ${step1Response.status} ${step1Response.statusText}`);
          }

          // Parse SSE stream from step 1
          const step1Data: any = {};
          if (step1Response.body) {
            const reader = step1Response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
              
              for (const line of lines) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.data) {
                    Object.assign(step1Data, data.data);
                  }
                  // Forward progress with step context
                  controller.enqueue(toSSE({ 
                    status: `Step 1/5: ${data.status || 'Processing...'}`, 
                    progress: Math.min(10 + (data.progress || 0) * 0.15, 20),
                    step: 1,
                    data: step1Data
                  }));
                } catch {
                  // Skip malformed chunks
                }
              }
            }
          }

          if (!step1Data.draftWorkflowNames || !step1Data.workflowContext) {
            throw new Error('Step 1 did not return required data: draftWorkflowNames and workflowContext');
          }

          controller.enqueue(toSSE({ 
            status: 'Step 1/5 completed: Context analyzed and workflows drafted', 
            progress: 20, 
            step: 1, 
            data: step1Data 
          }));

          // Step 2: Select & Refine Workflows
          controller.enqueue(toSSE({ status: 'Step 2/5: Refining workflow list...', progress: 25, step: 2 }));

          const step2Response = await fetch(`${baseUrl}/api/refine-workflow-list`, {
            ...requestOptions,
            body: JSON.stringify({
              userId,
              model,
              workflow_context: step1Data.workflowContext,
              draft_workflow_names: step1Data.draftWorkflowNames,
              ...(startDate && endDate && { startDate, endDate })
            })
          });

          if (!step2Response.ok) {
            throw new Error(`Step 2 failed: ${step2Response.status} ${step2Response.statusText}`);
          }

          const step2Data = await step2Response.json();
          
          if (!step2Data.refined_workflow_names) {
            throw new Error('Step 2 did not return required data: refined_workflow_names');
          }

          controller.enqueue(toSSE({ 
            status: 'Step 2/5 completed: Workflow list refined', 
            progress: 40, 
            step: 2, 
            data: { ...step1Data, identifiedWorkflowNames: step2Data.refined_workflow_names }
          }));

          // Step 3: Define Workflow Boundaries
          controller.enqueue(toSSE({ status: 'Step 3/5: Defining workflow boundaries...', progress: 45, step: 3 }));

          const step3Response = await fetch(`${baseUrl}/api/define-workflow-boundaries`, {
            ...requestOptions,
            body: JSON.stringify({
              model,
              context: {
                workflows: step2Data.refined_workflow_names.map((name: string) => ({ workflow_name: name })),
                userId,
                userContext: step1Data.workflowContext,
                userInstructions
              },
              ...(startDate && endDate && { startDate, endDate })
            })
          });

          if (!step3Response.ok) {
            throw new Error(`Step 3 failed: ${step3Response.status} ${step3Response.statusText}`);
          }

          const step3Data = await step3Response.json();
          
          if (!step3Data.workflows) {
            throw new Error('Step 3 did not return required data: workflows with boundaries');
          }

          // Transform boundaries to UI format
          const workflowBoundaries: Record<string, { trigger: string; terminator: string }> = {};
          step3Data.workflows.forEach((workflow: any) => {
            workflowBoundaries[workflow.workflow_name] = {
              trigger: workflow.trigger,
              terminator: workflow.terminator
            };
          });

          controller.enqueue(toSSE({ 
            status: 'Step 3/5 completed: Workflow boundaries defined', 
            progress: 60, 
            step: 3, 
            data: { 
              ...step1Data, 
              identifiedWorkflowNames: step2Data.refined_workflow_names,
              workflowBoundaries
            }
          }));

          // Step 4: Synthesize Workflows
          controller.enqueue(toSSE({ status: 'Step 4/5: Synthesizing workflows...', progress: 65, step: 4 }));

          const step4Response = await fetch(`${baseUrl}/api/synthesize-workflow`, {
            ...requestOptions,
            body: JSON.stringify({
              model,
              context: {
                workflows: step2Data.refined_workflow_names.map((name: string) => ({
                  name,
                  trigger: workflowBoundaries[name]?.trigger || '',
                  terminator: workflowBoundaries[name]?.terminator || ''
                })),
                userId,
                workflowContext: step1Data.workflowContext,
                userInstructions
              },
              ...(startDate && endDate && { startDate, endDate })
            })
          });

          if (!step4Response.ok) {
            throw new Error(`Step 4 failed: ${step4Response.status} ${step4Response.statusText}`);
          }

          const step4Data = await step4Response.json();
          
          if (!step4Data.workflows || step4Data.workflows.length === 0) {
            throw new Error('Step 4 did not return synthesized workflows');
          }

          controller.enqueue(toSSE({ 
            status: 'Step 4/5 completed: Workflows synthesized', 
            progress: 80, 
            step: 4, 
            data: { 
              ...step1Data, 
              identifiedWorkflowNames: step2Data.refined_workflow_names,
              workflowBoundaries,
              synthesizedWorkflows: step4Data.workflows
            }
          }));

          // Step 5: Create Timeline Mapping
          controller.enqueue(toSSE({ status: 'Step 5/5: Creating timeline mapping...', progress: 85, step: 5 }));

          const step5Response = await fetch(`${baseUrl}/api/analyze-raw-timeline-events`, {
            ...requestOptions,
            body: JSON.stringify({
              userId,
              model,
              ...(startDate && endDate && { startDate, endDate })
            })
          });

          if (!step5Response.ok) {
            throw new Error(`Step 5 failed: ${step5Response.status} ${step5Response.statusText}`);
          }

          // Parse SSE stream from step 5
          const step5Data: any = {};
          if (step5Response.body) {
            const reader = step5Response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
              
              for (const line of lines) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.data) {
                    Object.assign(step5Data, data.data);
                  }
                  // Forward progress with step context
                  controller.enqueue(toSSE({ 
                    status: `Step 5/5: ${data.status || 'Processing timeline mapping...'}`, 
                    progress: Math.min(85 + (data.progress || 0) * 0.10, 95),
                    step: 5
                  }));
                } catch {
                  // Skip malformed chunks
                }
              }
            }
          }

          // Complete orchestration
          controller.enqueue(toSSE({ 
            status: 'All 5 steps completed successfully! Workflow orchestration finished.', 
            progress: 100, 
            step: 5,
            data: { 
              ...step1Data, 
              identifiedWorkflowNames: step2Data.refined_workflow_names,
              workflowBoundaries,
              synthesizedWorkflows: step4Data.workflows,
              timelineAnnotations: step5Data.workflow_mappings || []
            },
            success: true
          }));

          console.log('✅ 5-step workflow orchestration completed successfully for user:', userId);

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