import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateWorkflowStepAnalysis, saveWorkflowStepAnalysis } from '@/lib/workflowAnalysis';
import { WORKFLOW_STEP_ANALYSIS_PROMPT } from '@/lib/prompts';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST() {
  try {
    // 1. Dequeue a job
    const { data: jobs, error: jobError } = await supabaseAdmin.rpc('dequeue_workflow_job');

    if (jobError) {
      console.error("Error dequeuing job:", jobError);
      return NextResponse.json({ error: 'Could not dequeue job' }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ message: 'No pending jobs found.' }, { status: 200 });
    }

    const job = jobs[0];
    const { id: jobId, user_id: userId, payload } = job;

    try {
        // 2. Generate Analysis
        const analysisResult = await generateWorkflowStepAnalysis(
            WORKFLOW_STEP_ANALYSIS_PROMPT,
            'gemini-2.5-pro-preview-06-05',
            payload.context // The context is pre-built and stored in the job payload
        );

        // 3. Save Analysis
        await saveWorkflowStepAnalysis(
            userId,
            payload.event.session_id,
            payload.event.created_at,
            analysisResult
        );

        // 4. Mark job as complete
        await supabaseAdmin.from('workflow_analysis_jobs').update({ status: 'completed' }).eq('id', jobId);

        // Trigger the next worker to continue the chain
        const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        fetch(`${host}/api/process-workflow-job`, { method: 'POST' }).catch(e => console.error("Error triggering next worker:", e));

        return NextResponse.json({ success: true, jobId });

    } catch(processingError) {
        console.error(`[Job ${jobId}] Error processing job:`, processingError);
        await supabaseAdmin.from('workflow_analysis_jobs').update({ status: 'failed' }).eq('id', jobId);
        // Re-throw or handle as needed
        throw processingError;
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

// We need a function to lock and retrieve the next job
/*
const createDequeueFunctionSql = `
CREATE OR REPLACE FUNCTION dequeue_workflow_job()
RETURNS TABLE(id BIGINT, user_id UUID, payload JSONB) AS $$
DECLARE
    job_id BIGINT;
BEGIN
    SELECT j.id INTO job_id
    FROM workflow_analysis_jobs j
    WHERE j.status = 'pending'
    ORDER BY j.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF job_id IS NOT NULL THEN
        UPDATE workflow_analysis_jobs
        SET status = 'in_progress', updated_at = NOW()
        WHERE workflow_analysis_jobs.id = job_id
        RETURNING workflow_analysis_jobs.id, workflow_analysis_jobs.user_id, workflow_analysis_jobs.payload
        INTO id, user_id, payload;
        RETURN NEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;
`
*/
// You would run this SQL in your database to create the function.
// For example, in a new migration file. 