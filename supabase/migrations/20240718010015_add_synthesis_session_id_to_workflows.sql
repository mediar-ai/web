ALTER TABLE public.low_level_workflows
ADD COLUMN synthesis_session_id BIGINT,
ADD CONSTRAINT fk_synthesis_session
FOREIGN KEY (synthesis_session_id)
REFERENCES public.synthesis_sessions(id)
ON DELETE SET NULL; 