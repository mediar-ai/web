-- =============================================================================
-- Migration: Remove 'preferred' assignment type
-- Created: 2025-02-07
-- Description: Simplifies machine assignments to only use 'exclusive' type.
--              Workflows either have exclusive assignment (strict) or use auto-assignment.
-- =============================================================================

-- Step 1: Handle existing 'preferred' assignments
-- Delete all preferred assignments (workflows will fall back to auto-assignment)
-- This is the safest option - preserves flexible execution behavior
DELETE FROM public.workflow_machine_assignments 
WHERE assignment_type = 'preferred';

-- Log the number of affected assignments
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % preferred assignments', deleted_count;
END $$;

-- Step 2: Update the constraint to remove 'preferred' from allowed values
ALTER TABLE public.workflow_machine_assignments 
DROP CONSTRAINT IF EXISTS workflow_machine_assignments_assignment_type_check;

ALTER TABLE public.workflow_machine_assignments 
ADD CONSTRAINT workflow_machine_assignments_assignment_type_check 
CHECK (assignment_type IN ('exclusive', 'fallback', 'blocked'));

-- Step 3: Remove the DEFAULT value (force explicit assignment type)
ALTER TABLE public.workflow_machine_assignments 
ALTER COLUMN assignment_type DROP DEFAULT;

-- Step 4: Update the get_optimal_machine_for_workflow function
-- Remove the 'preferred' tier from the assignment logic
CREATE OR REPLACE FUNCTION get_optimal_machine_for_workflow(
    p_workflow_id BIGINT,
    p_execution_params JSONB DEFAULT '{}'
) RETURNS TABLE(
    machine_id INTEGER,
    machine_name VARCHAR(255),
    assignment_reason TEXT,
    load_percentage DECIMAL
) AS $$
BEGIN
    -- First, try exclusive assignments
    RETURN QUERY
    SELECT 
        rm.id,
        rm.name,
        'Exclusive assignment' as assignment_reason,
        aml.load_percentage
    FROM public.remote_machines rm
    JOIN public.workflow_machine_assignments wma ON rm.id = wma.machine_id
    JOIN public.available_machines_with_load aml ON rm.id = aml.id
    WHERE wma.workflow_id = p_workflow_id 
    AND wma.assignment_type = 'exclusive' 
    AND wma.is_active = true
    AND aml.available_capacity > 0
    ORDER BY wma.priority, aml.load_percentage
    LIMIT 1;
    
    -- If no exclusive assignments found, use any available machine (load balanced)
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            aml.id,
            aml.name,
            'Auto-assigned (load balanced)' as assignment_reason,
            aml.load_percentage
        FROM public.available_machines_with_load aml
        WHERE aml.available_capacity > 0
        AND aml.id NOT IN (
            SELECT wma.machine_id 
            FROM public.workflow_machine_assignments wma 
            WHERE wma.workflow_id = p_workflow_id 
            AND wma.assignment_type = 'blocked' 
            AND wma.is_active = true
        )
        ORDER BY aml.priority, aml.load_percentage
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Add documentation comments
COMMENT ON CONSTRAINT workflow_machine_assignments_assignment_type_check 
ON public.workflow_machine_assignments 
IS 'Assignment types: exclusive (strict, blocks if unavailable), fallback (future use), blocked (exclusion list). Removed preferred type - workflows now either have exclusive assignment or use auto-assignment.';

COMMENT ON FUNCTION get_optimal_machine_for_workflow(BIGINT, JSONB) 
IS 'Returns optimal machine: exclusive assignment (if exists and available) or auto-assigned via load balancing. Removed preferred tier.';

-- Step 6: Verification query
DO $$
DECLARE
    exclusive_count INTEGER;
    fallback_count INTEGER;
    blocked_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO exclusive_count FROM public.workflow_machine_assignments WHERE assignment_type = 'exclusive';
    SELECT COUNT(*) INTO fallback_count FROM public.workflow_machine_assignments WHERE assignment_type = 'fallback';
    SELECT COUNT(*) INTO blocked_count FROM public.workflow_machine_assignments WHERE assignment_type = 'blocked';
    
    RAISE NOTICE '=== Migration Complete ===';
    RAISE NOTICE 'Exclusive assignments: %', exclusive_count;
    RAISE NOTICE 'Fallback assignments: %', fallback_count;
    RAISE NOTICE 'Blocked assignments: %', blocked_count;
    RAISE NOTICE 'Preferred assignments should be 0 after migration';
END $$;

