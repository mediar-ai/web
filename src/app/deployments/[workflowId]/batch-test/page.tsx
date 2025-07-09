'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Workflow } from '@/lib/workflow-types';
import { BatchForm } from '@/components/deployments/BatchForm';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x: string]: JsonValue };

export default function BatchTestPage() {
  const router = useRouter();
  const params = useParams();
  const workflowId = params.workflowId as string;

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totalCombinations, setTotalCombinations] = useState(0);
  const [batchSpec, setBatchSpec] = useState<{ static_parameters: JsonObject; dynamic_parameters: Record<string, JsonValue[]> } | null>(null);

  const fetchWorkflowDetails = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}`);
      const data = await response.json();
      if (data.success) {
        setWorkflow(data.workflow);
      } else {
        console.error('Failed to fetch workflow details');
      }
    } catch (error) {
      console.error('Failed to fetch workflow details:', error);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    fetchWorkflowDetails();
  }, [fetchWorkflowDetails]);

  const handleBatchSubmit = async () => {
    if (!batchSpec || totalCombinations === 0) return;
    setIsSubmitting(true);
    try {
        const response = await fetch(`/api/remote-workflows/${workflowId}/batch-execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batchSpec)
        });
        const result = await response.json();
        if (result.success) {
            // Potentially show a success toast
            router.push('/deployments');
        } else {
            // Potentially show an error toast
            console.error('Failed to submit batch:', result.error);
        }
    } catch (error) {
        console.error('Failed to submit batch:', error);
    } finally {
        setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading workflow details...</div>;
  }

  if (!workflow) {
    return <div className="p-6">Workflow not found.</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <Button variant="ghost" asChild>
          <Link href="/deployments">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Deployments
          </Link>
        </Button>
        <h1 className="text-3xl font-bold mt-2">Create Batch Test</h1>
        <p className="text-muted-foreground">
          Configure and run a test suite for the &quot;{workflow.name}&quot; workflow.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel: Configurator */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Variable Configurator</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Define static values or iterate over multiple dynamic values for each parameter.
              </p>
              {workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0 ? (
                <BatchForm
                  schema={workflow.input_parameters as JsonObject}
                  onSpecChange={setBatchSpec}
                  onCombinationsChange={setTotalCombinations}
                />
              ) : (
                <p>This workflow has no configurable parameters.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel: Summary & Execution */}
        <div>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Batch Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-mono text-sm uppercase text-muted-foreground">Total Combinations</h3>
                  <p className="text-4xl font-bold">{totalCombinations}</p>
                </div>
                <Button 
                  className="w-full" 
                  size="lg" 
                  disabled={totalCombinations === 0 || isSubmitting || totalCombinations > 500}
                  onClick={handleBatchSubmit}
                >
                  {isSubmitting ? 'Submitting...' : `Queue ${totalCombinations} Executions`}
                </Button>
                 {totalCombinations > 500 && (
                    <p className="text-red-500 text-xs text-center font-semibold">
                        Warning: Batch size exceeds the limit of 500.
                    </p>
                 )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
