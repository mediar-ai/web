/**
 * Apply migration to add github_folder and github_ref to deployed_workflows_with_sequence view
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://eshwntsgsputksqamckh.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const migrationSQL = `
-- Migration: Add github_folder and github_ref to deployed_workflows_with_sequence view
CREATE OR REPLACE VIEW deployed_workflows_with_sequence AS
SELECT
    dw.id,
    dw.name,
    dw.description,
    dw.version,
    dw.status,
    dw.automation_sequence,
    dw.automation_sequence_yaml,
    dw.validation_checks,
    dw.error_handling,
    dw.input_parameters,
    dw.expected_outputs,
    dw.sample_inputs,
    dw.estimated_duration_seconds,
    dw.timeout_minutes,
    dw.category,
    dw.successful_runs,
    dw.failed_runs,
    dw.cancelled_runs,
    dw.total_executions,
    dw.last_successful_execution,
    dw.last_failed_execution,
    dw.created_by,
    dw.created_at,
    dw.updated_at,
    dw.modal_function_name,
    dw.deployment_status,
    dw.last_deployed_at,
    dw.active_version,
    dw.workflow_type,
    dw.parent_workflow_id,
    dw.cron_schedule,
    dw.cron_enabled,
    dw.last_cron_run,
    dw.next_cron_run,
    dw.requires_files,
    dw.files_config,
    dw.skip_cancellation_check,
    dw.organization_id,
    dw.github_folder,
    dw.github_ref,
    dw.github_path,
    o.name as organization_name
FROM public.deployed_workflows dw
LEFT JOIN public.organizations o ON dw.organization_id = o.id
WHERE dw.status = 'active';
`;

async function applyMigration() {
  console.log('Applying view migration to add github fields...');

  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      console.error('Error applying migration:', error);
      process.exit(1);
    }

    console.log('✓ Migration applied successfully!');

    // Verify the view now includes github_folder
    const { data: testData, error: testError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('github_folder')
      .limit(1);

    if (testError) {
      console.error('Error verifying migration:', testError);
      process.exit(1);
    }

    console.log('✓ View now includes github_folder column');
    console.log('✓ Migration complete!');

  } catch (err) {
    console.error('Exception:', err);
    process.exit(1);
  }
}

applyMigration();
