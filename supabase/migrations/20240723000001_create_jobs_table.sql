CREATE TABLE public.workflow_analysis_jobs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    event_id BIGINT NOT NULL,
    status TEXT DEFAULT 'pending',
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.workflow_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service roles" ON public.workflow_analysis_jobs FOR ALL
USING (true)
WITH CHECK (true); 