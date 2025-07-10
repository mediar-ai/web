-- Function to increment the patch version of a semantic version string
CREATE OR REPLACE FUNCTION increment_version(version_text TEXT)
RETURNS TEXT AS $$
DECLARE
    parts TEXT[];
    patch_version INT;
BEGIN
    -- Split the version string by '.'
    parts := string_to_array(version_text, '.');
    
    -- Check if there are 3 parts
    IF array_length(parts, 1) != 3 THEN
        -- If not in X.Y.Z format, return a default starting version
        RETURN '1.0.1';
    END IF;

    -- Increment the patch version (the last part)
    patch_version := parts[3]::INT + 1;
    
    -- Return the new version string
    RETURN parts[1] || '.' || parts[2] || '.' || patch_version::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Trigger function that gets called on update
CREATE OR REPLACE FUNCTION autoincrement_workflow_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the automation_sequence has actually changed
    IF NEW.automation_sequence IS DISTINCT FROM OLD.automation_sequence THEN
        -- If it has, set the new version by calling the increment function
        NEW.version = increment_version(OLD.version);
    END IF;
    
    -- Return the modified row
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on the deployed_workflows table
CREATE TRIGGER trigger_autoincrement_workflow_version
BEFORE UPDATE ON public.deployed_workflows
FOR EACH ROW
EXECUTE FUNCTION autoincrement_workflow_version();

COMMENT ON FUNCTION increment_version(TEXT) IS 'Increments the patch number of a semantic version string (e.g., 1.0.23 -> 1.0.24)';
COMMENT ON TRIGGER trigger_autoincrement_workflow_version ON public.deployed_workflows IS 'Automatically increments the patch version when the automation_sequence is modified.';
