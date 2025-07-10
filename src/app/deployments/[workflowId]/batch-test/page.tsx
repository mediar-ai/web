'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BatchForm } from '@/components/deployments/BatchForm';
import { Workflow } from '@/lib/workflow-types';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x: string]: JsonValue };

interface BatchSpec {
  static_parameters: JsonObject;
  dynamic_parameters: Record<string, JsonValue[]>;
}

export default function BatchTestPage({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = use(params);
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [batchSpec, setBatchSpec] = useState<BatchSpec>({
    static_parameters: {},
    dynamic_parameters: {}
  });
  const [totalCombinations, setTotalCombinations] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create a storage key specific to this workflow
  const storageKey = `batch-test-${workflowId}`;

  const fetchWorkflowDetails = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/remote-workflows/${workflowId}/overview`);
      const data = await response.json();
      if (data.success) {
        setWorkflow(data.workflow);
        
        // Load saved batch spec from localStorage
        const savedSpec = localStorage.getItem(storageKey);
        if (savedSpec) {
          try {
            const parsedSpec = JSON.parse(savedSpec);
            setBatchSpec(parsedSpec);
          } catch (e) {
            console.error('Failed to parse saved batch spec:', e);
          }
        }
      } else {
        console.error('Failed to fetch workflow details:', data.error);
      }
    } catch (error) {
      console.error('Error fetching workflow details:', error);
    } finally {
      setLoading(false);
    }
  }, [workflowId, storageKey]);

  useEffect(() => {
    fetchWorkflowDetails();
  }, [fetchWorkflowDetails]);

  // Save batch spec to localStorage whenever it changes
  useEffect(() => {
    if (Object.keys(batchSpec).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(batchSpec));
    }
  }, [batchSpec, storageKey]);

  const handleReset = () => {
    // Clear the batch spec
    setBatchSpec({
      static_parameters: {},
      dynamic_parameters: {}
    });
    setTotalCombinations(0);
    // Remove from localStorage
    localStorage.removeItem(storageKey);
    // Trigger a re-render of the form
    fetchWorkflowDetails();
  };

  const handleBatchSubmit = async () => {
    if (!batchSpec || totalCombinations === 0) return;
    
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/batch-execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchSpec),
      });

      const data = await response.json();
      if (data.success) {
        router.push('/deployments');
      } else {
        console.error('Failed to submit batch:', data.error);
      }
    } catch (error) {
      console.error('Error submitting batch:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Loading workflow details...</div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Workflow not found</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" asChild>
            <Link href="/deployments">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Deployments
            </Link>
          </Button>
          <Button variant="outline" onClick={handleReset} size="sm">
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to Defaults
          </Button>
        </div>
        <h1 className="text-3xl font-bold">Create Batch Test</h1>
        <p className="text-muted-foreground">
          Configure and run a test suite for the &quot;{workflow.name}&quot; workflow.
        </p>
      </div>

      {/* Batch Summary at the top */}
      <Card>
        <CardHeader>
          <CardTitle>Batch Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-mono text-sm uppercase text-muted-foreground">Total Combinations</h3>
              <p className="text-4xl font-bold">{totalCombinations}</p>
            </div>
            <Button 
              className="ml-4" 
              size="lg" 
              disabled={totalCombinations === 0 || isSubmitting || totalCombinations > 500}
              onClick={handleBatchSubmit}
            >
              {isSubmitting ? 'Submitting...' : `Queue ${totalCombinations} Executions`}
            </Button>
          </div>
          {totalCombinations > 500 && (
            <p className="text-red-500 text-xs mt-2 font-semibold">
              Warning: Batch size exceeds the limit of 500.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Variable Configurator below */}
      <Card>
        <CardHeader>
          <CardTitle>Variable Configurator</CardTitle>
          <p className="text-sm text-muted-foreground">
            Define static values or iterate over multiple dynamic values for each parameter.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <BatchForm
                schema={workflow.input_parameters as JsonObject}
                onSpecChange={setBatchSpec}
                onCombinationsChange={setTotalCombinations}
              />
            </div>
          ) : (
            <p className="p-6">This workflow has no configurable parameters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
