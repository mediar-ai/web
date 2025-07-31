import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('id, name, automation_sequence, status')
      .eq('id', workflowId)
      .single();

    if (workflowError) {
      const errorResponse = {
        success: false,
        error: `Workflow ${workflowIdNum} not found`,
        timestamp: new Date().toISOString()
      };

      // Cache the error response for documentation
      await cacheResponse({
        endpointPath: '/api/remote-workflows/[workflowId]',
        httpMethod: 'GET',
        statusCode: 404,
        responseBody: errorResponse,
        requestParams: { workflowId: workflowIdNum },
        executionTimeMs: 25
      });

      return NextResponse.json(errorResponse, { status: 404 });
    }

    // --- DYNAMICALLY GENERATE SAMPLE INPUTS ---
    let sampleInputs = {};
    try {
        if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
          const mainSequence = workflow.automation_sequence[0];
          if (mainSequence.arguments && mainSequence.arguments.variables) {
            sampleInputs = mainSequence.arguments.variables;
          }
        }
    } catch (e) {
        console.error(`Error parsing variables for workflow ${workflowIdNum}:`, e);
    }
    // --- END DYNAMIC GENERATION ---

    // Build comprehensive workflow details
    const workflowDetails = {
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      
      // Execution Information
      trigger_info: {
        endpoint: `/api/remote-workflows/${workflowIdNum}/execute`,
        method: 'POST',
        required_headers: ['Content-Type: application/json'],
        status: workflow.status,
        is_executable: workflow.status === 'deployed'
      },
      
      // Workflow Definition (from database)
      automation_sequence: workflow.automation_sequence,
      
      // Usage Examples
      usage_examples: {
        curl_example: `curl -X POST \\
  ${process.env.VERCEL_URL || 'https://app.mediar.ai'}/api/remote-workflows/${workflowIdNum}/execute \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sampleInputs, null, 2)}'`,
        
        javascript_example: `fetch('/api/remote-workflows/${workflowIdNum}/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(sampleInputs)})
}).then(response => response.json())`
      }
    };

    const responseData = {
      success: true,
      workflow: workflowDetails,
      timestamp: new Date().toISOString()
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/[workflowId]',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: { workflowId: workflowIdNum },
      executionTimeMs: 50 // placeholder
    });

    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('[ERROR] Error getting workflow details:', error);
    
    const errorResponse = {
      success: false,
      error: 'Failed to retrieve workflow details',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };

    // Cache the error response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/[workflowId]',
      httpMethod: 'GET',
      statusCode: 500,
      responseBody: errorResponse,
      requestParams: {},
      executionTimeMs: 25
    });
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
} 