CREATE OR REPLACE FUNCTION count_distinct_sessions(p_user_id TEXT)
RETURNS INTEGER AS $$
DECLARE
    session_count INTEGER;
BEGIN
    SELECT
        count(DISTINCT session_id)
    INTO
        session_count
    FROM
        public.low_level_events
    WHERE
        user_id = p_user_id;
    
    RETURN session_count;
END;
$$ LANGUAGE plpgsql; 