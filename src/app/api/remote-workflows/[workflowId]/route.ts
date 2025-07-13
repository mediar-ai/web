import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    console.log(`⚡ Fast workflow details for ${workflowIdNum} from Vercel...`);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, automation_sequence, status')
      .eq('id', workflowId)
      .single();

    if (workflowError) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
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

    return NextResponse.json({
      success: true,
      workflow: workflowDetails,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting workflow details:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflow details',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 