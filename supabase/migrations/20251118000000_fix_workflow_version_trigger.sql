-- Fix the workflow version trigger to query actual max version from history
-- instead of using stale OLD.version field

CREATE OR REPLACE FUNCTION create_new_workflow_version()
RETURNS TRIGGER AS $$
DECLARE
    new_version_number text;
    max_existing_version text;
BEGIN
    -- Query the ACTUAL max version from the version history table
    -- This is the critical fix - don't trust OLD.version
    SELECT version_number INTO max_existing_version
    FROM deployed_workflow_versions
    WHERE workflow_id = NEW.id
    ORDER BY created_at DESC
    LIMIT 1;

    -- If no versions exist yet, use OLD.version as starting point
    IF max_existing_version IS NULL THEN
        max_existing_version := OLD.version;
    END IF;

    -- Increment from the actual max version
    new_version_number := increment_version(max_existing_version);

    -- Create new version record
    INSERT INTO deployed_workflow_versions (
        workflow_id,
        version_number,
        automation_sequence,
        automation_sequence_yaml,
        created_at
    ) VALUES (
        NEW.id,
        new_version_number,
        NEW.automation_sequence,
        NEW.automation_sequence_yaml,
        NOW()
    );

    -- Update the workflow's version field to match
    NEW.version := new_version_number;
    NEW.total_versions := COALESCE(OLD.total_versions, 0) + 1;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger definition remains the same (just recreating for clarity)
DROP TRIGGER IF EXISTS trigger_create_workflow_version ON deployed_workflows;

CREATE TRIGGER trigger_create_workflow_version
BEFORE UPDATE ON deployed_workflows
FOR EACH ROW
WHEN (
    OLD.automation_sequence IS DISTINCT FROM NEW.automation_sequence
    OR OLD.automation_sequence_yaml IS DISTINCT FROM NEW.automation_sequence_yaml
)
EXECUTE FUNCTION create_new_workflow_version();
