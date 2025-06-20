CREATE OR REPLACE FUNCTION dequeue_user_workflow_job(p_user_id UUID)
RETURNS TABLE(id BIGINT, user_id UUID, payload JSONB) AS $$
DECLARE
    job_id BIGINT;
BEGIN
    SELECT j.id INTO job_id
    FROM public.workflow_analysis_jobs j
    WHERE j.status = 'pending' AND j.user_id = p_user_id
    ORDER BY j.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF job_id IS NOT NULL THEN
        UPDATE public.workflow_analysis_jobs
        SET status = 'in_progress', updated_at = NOW()
        WHERE workflow_analysis_jobs.id = job_id
        RETURNING workflow_analysis_jobs.id, workflow_analysis_jobs.user_id, workflow_analysis_jobs.payload
        INTO id, user_id, payload;
        RETURN NEXT;
    END IF;
END;
$$ LANGUAGE plpgsql; 