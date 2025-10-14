#!/bin/bash

# Apply view migration via Supabase SQL Editor API
# Uses service role key to execute arbitrary SQL

SUPABASE_URL="https://eshwntsgsputksqamckh.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0"

SQL_QUERY='CREATE OR REPLACE VIEW deployed_workflows_with_sequence AS SELECT dw.id, dw.name, dw.description, dw.version, dw.status, dw.automation_sequence, dw.automation_sequence_yaml, dw.validation_checks, dw.error_handling, dw.input_parameters, dw.expected_outputs, dw.sample_inputs, dw.estimated_duration_seconds, dw.timeout_minutes, dw.category, dw.successful_runs, dw.failed_runs, dw.cancelled_runs, dw.total_executions, dw.last_successful_execution, dw.last_failed_execution, dw.created_by, dw.created_at, dw.updated_at, dw.modal_function_name, dw.deployment_status, dw.last_deployed_at, dw.active_version, dw.workflow_type, dw.parent_workflow_id, dw.cron_schedule, dw.cron_enabled, dw.last_cron_run, dw.next_cron_run, dw.requires_files, dw.files_config, dw.skip_cancellation_check, dw.organization_id, dw.github_folder, dw.github_ref, dw.github_path, o.name as organization_name FROM public.deployed_workflows dw LEFT JOIN public.organizations o ON dw.organization_id = o.id WHERE dw.status = '\''active'\'';'

echo "Applying view migration to add github fields..."

# Try using supabase REST API with a custom SQL endpoint
curl -X POST \
  "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"sql\": \"$SQL_QUERY\"}"

echo ""
echo "Migration sent!"
