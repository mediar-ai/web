CREATE TABLE public.synthesis_sessions (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    session_state JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS Policies for synthesis_sessions
ALTER TABLE public.synthesis_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own synthesis sessions"
ON public.synthesis_sessions FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own synthesis sessions"
ON public.synthesis_sessions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own synthesis sessions"
ON public.synthesis_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own synthesis sessions"
ON public.synthesis_sessions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_synthesis_session_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_synthesis_session_update
BEFORE UPDATE ON public.synthesis_sessions
FOR EACH ROW
EXECUTE FUNCTION public.handle_synthesis_session_update(); 