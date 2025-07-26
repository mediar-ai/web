ALTER TABLE public.synthesis_sessions
ADD COLUMN IF NOT EXISTS orchestration_status TEXT,
ADD COLUMN IF NOT EXISTS orchestration_progress INTEGER,
ADD COLUMN IF NOT EXISTS orchestration_data JSONB,
ADD COLUMN IF NOT EXISTS final_result_url TEXT; 