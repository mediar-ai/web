import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// This is the full URL of the internal processing API
const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
const processStepApiUrl = `${vercelUrl}/api/process-workflow-step`;

export async function POST(req: NextRequest) {
  try {
    const { userId, sessionId, clientTimestamp, context, model } = await req.json();

    if (!userId || !sessionId || !clientTimestamp || !context || !model) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Delete any existing analysis to allow for re-processing
    await supabase
      .from('low_level_workflow_analyses')
      .delete()
      .match({ 
        user_id: userId, 
        client_timestamp: new Date(clientTimestamp).toISOString() 
      });

    // 2. Call the original, stateless processing API to generate the analysis
    const processResponse = await fetch(processStepApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: 'WORKFLOW_STEP_ANALYSIS_V2_PROMPT',
        context, 
        model 
      }),
    });

    if (!processResponse.ok) {
      const errorBody = await processResponse.json();
      throw new Error(`Core processor failed: ${errorBody.details || processResponse.statusText}`);
    }

    const { analysis, structured_output: structuredOutput } = await processResponse.json();

    if (!structuredOutput) {
      throw new Error('Core processor did not return a valid structured_output.');
    }

    // 3. Save the new analysis to the database
    const { error: insertError } = await supabase.from('low_level_workflow_analyses').insert([{
        user_id: userId,
        session_id: sessionId,
        client_timestamp: new Date(clientTimestamp).toISOString(),
        llm_structured_output: structuredOutput,
    }]);

    if (insertError) {
      throw new Error(`Failed to save new analysis to DB: ${insertError.message}`);
    }

    // 4. Return the successful analysis to the UI
    return NextResponse.json({ success: true, analysis });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API/UI/process-step] Error:', errorMessage);
    return NextResponse.json({ error: 'Failed to process step.', details: errorMessage }, { status: 500 });
  }
} 