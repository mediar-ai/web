-- Fix machines with NULL status - set them to 'active'
UPDATE remote_machines
SET status = 'active'
WHERE status IS NULL;

-- Also ensure health_status has a default value if NULL
UPDATE remote_machines
SET health_status = 'unknown'
WHERE health_status IS NULL;