-- First, drop the existing function to allow changing the return type.
DROP FUNCTION IF EXISTS find_closest_screenshot(text,text,text);

-- Function to find the screenshot with the filename timestamp closest to a target timestamp.
-- It now returns a JSON object with the filename and both timestamps.
CREATE OR REPLACE FUNCTION find_closest_screenshot(
    p_user_id TEXT,
    p_session_id TEXT,
    p_target_timestamp_text TEXT
)
RETURNS JSON AS $$
DECLARE
    result RECORD;
    target_epoch BIGINT;
BEGIN
    -- Convert the text timestamp from the API (which is in milliseconds) to a BIGINT
    target_epoch := (p_target_timestamp_text::numeric);

    SELECT 
        o.path_tokens[4] as filename,
        (substring(o.path_tokens[4] from '(\\d{13,})$'))::numeric as screenshot_timestamp,
        target_epoch as event_timestamp
    INTO 
        result
    FROM 
        storage.objects o
    WHERE 
        o.bucket_id = 'low-level-event-screenshots'
        AND o.path_tokens[1] = p_user_id
        AND o.path_tokens[2] = p_session_id
        AND o.path_tokens[3] = 'screenshots'
    ORDER BY
        abs(
            -- This regex now specifically captures the large number at the end of the filename.
            (substring(o.path_tokens[4] from '(\\d{13,})$'))::numeric - target_epoch
        )
    LIMIT 1;

    RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql; 