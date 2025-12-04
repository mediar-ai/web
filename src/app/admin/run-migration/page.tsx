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
      const response = await fetch('/api/admin/run-migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          migration_file: '20250210000000_add_get_workflow_version_history.sql'
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.details || 'Migration failed');
      }

      setResult({
        success: true,
        message: data.message || 'Migration applied successfully!',
        functions: ['get_workflow_version_history', 'activate_workflow_version'],
        details: data.results
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
