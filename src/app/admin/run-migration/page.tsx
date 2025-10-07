'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function RunMigrationPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runMigration = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Execute SQL statements via Supabase client
      const { createClient } = await import('@supabase/supabase-js');

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

      const supabase = createClient(supabaseUrl, supabaseKey);

      // Function 1: get_workflow_version_history
      const sql1 = `
        CREATE OR REPLACE FUNCTION get_workflow_version_history(p_workflow_id bigint)
        RETURNS TABLE (
            version_id bigint,
            version_number text,
            is_active boolean,
            created_at timestamptz,
            change_notes text,
            execution_count bigint
        ) AS $$
        BEGIN
            RETURN QUERY
            SELECT
                v.id as version_id,
                v.version_number,
                v.is_active,
                v.created_at,
                COALESCE(v.change_notes, '') as change_notes,
                COALESCE(COUNT(e.id), 0) as execution_count
            FROM
                deployed_workflow_versions v
            LEFT JOIN
                workflow_executions e
                ON e.workflow_id = v.workflow_id
                AND e.workflow_version_number = v.version_number
            WHERE
                v.workflow_id = p_workflow_id
            GROUP BY
                v.id, v.version_number, v.is_active, v.created_at, v.change_notes
            ORDER BY
                v.created_at DESC;
        END;
        $$ LANGUAGE plpgsql;
      `;

      // Function 2: activate_workflow_version
      const sql2 = `
        CREATE OR REPLACE FUNCTION activate_workflow_version(
            p_workflow_id bigint,
            p_version_number text
        ) RETURNS void AS $$
        DECLARE
            v_version_id bigint;
            v_current_active_version_id bigint;
        BEGIN
            SELECT id INTO v_version_id
            FROM deployed_workflow_versions
            WHERE workflow_id = p_workflow_id
              AND version_number = p_version_number;

            IF v_version_id IS NULL THEN
                RAISE EXCEPTION 'Version % not found for workflow %', p_version_number, p_workflow_id;
            END IF;

            SELECT id INTO v_current_active_version_id
            FROM deployed_workflow_versions
            WHERE workflow_id = p_workflow_id
              AND is_active = true;

            UPDATE deployed_workflow_versions
            SET is_active = false,
                updated_at = NOW()
            WHERE workflow_id = p_workflow_id
              AND is_active = true;

            UPDATE deployed_workflow_versions
            SET is_active = true,
                updated_at = NOW()
            WHERE id = v_version_id;

            UPDATE deployed_workflows
            SET current_version_id = v_version_id,
                version = p_version_number,
                updated_at = NOW()
            WHERE id = p_workflow_id;

            RAISE NOTICE 'Activated version % (ID: %) for workflow %', p_version_number, v_version_id, p_workflow_id;
        END;
        $$ LANGUAGE plpgsql;
      `;

      // Try to execute via RPC
      console.log('Executing Function 1: get_workflow_version_history');
      const { data: data1, error: error1 } = await supabase.rpc('exec_sql', { query: sql1 });

      console.log('Executing Function 2: activate_workflow_version');
      const { data: data2, error: error2 } = await supabase.rpc('exec_sql', { query: sql2 });

      if (error1 || error2) {
        throw new Error(`RPC Error: ${error1?.message || error2?.message}`);
      }

      setResult({
        success: true,
        message: 'Migration applied successfully!',
        functions: ['get_workflow_version_history', 'activate_workflow_version']
      });

    } catch (err) {
      console.error('Migration error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-4xl mx-auto p-8">
      <div className="border-2 border-black bg-white p-8">
        <h1 className="text-3xl font-mono font-bold mb-4">Run Database Migration</h1>
        <p className="text-gray-600 mb-6">
          This will apply migration <code className="bg-gray-100 px-2 py-1 rounded">20250210000000_add_get_workflow_version_history.sql</code>
        </p>

        <div className="space-y-4 mb-6">
          <div className="bg-gray-50 border border-gray-200 p-4">
            <h3 className="font-mono font-bold mb-2">Creates 2 Functions:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li><code>get_workflow_version_history(workflow_id)</code> - Returns version list with execution counts</li>
              <li><code>activate_workflow_version(workflow_id, version_number)</code> - Activates a version and updates current_version_id</li>
            </ul>
          </div>
        </div>

        <Button
          onClick={runMigration}
          disabled={loading}
          className="bg-black text-white hover:bg-gray-800"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Applying Migration...
            </>
          ) : (
            'Run Migration'
          )}
        </Button>

        {result && (
          <Alert className="mt-6 border-black bg-green-50">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              <div className="font-bold mb-2">{result.message}</div>
              <div className="text-sm">
                Functions created:
                <ul className="list-disc list-inside ml-2">
                  {result.functions.map((f: string) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="mt-6 border-black bg-red-50">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="font-bold mb-2">Migration Failed</div>
              <div className="text-sm font-mono">{error}</div>
              <div className="mt-4 text-sm">
                <strong>Alternative: Run in Supabase SQL Editor</strong>
                <ol className="list-decimal list-inside ml-2 mt-2 space-y-1">
                  <li>Go to Supabase Dashboard → SQL Editor</li>
                  <li>Copy the SQL from <code>supabase/migrations/20250210000000_add_get_workflow_version_history.sql</code></li>
                  <li>Paste and run it directly in the SQL editor</li>
                </ol>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
