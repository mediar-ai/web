ALTER TABLE public.deployed_workflows
  DROP COLUMN IF EXISTS input_parameters,
  DROP COLUMN IF EXISTS error_handling,
  DROP COLUMN IF EXISTS validation_checks,
  DROP COLUMN IF EXISTS expected_outputs,
  DROP COLUMN IF EXISTS sample_inputs,
  DROP COLUMN IF EXISTS modal_function_name,
  DROP COLUMN IF EXISTS last_deployed_at; 