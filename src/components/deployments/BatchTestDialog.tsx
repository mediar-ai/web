'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RotateCcw } from 'lucide-react';
import { BatchForm } from '@/components/deployments/BatchForm';
import { Workflow } from '@/lib/workflow-types';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue> | null;
type JsonObject = { [x: string]: JsonValue };

interface BatchSpec {
  static_parameters: JsonObject;
  dynamic_parameters: Record<string, JsonValue[]>;
}

interface BatchTestDialogProps {
  workflow: Workflow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: () => void;
}

export function BatchTestDialog({ workflow, open, onOpenChange, onSubmit }: BatchTestDialogProps) {
  const [batchSpec, setBatchSpec] = useState<BatchSpec>({
    static_parameters: {},
    dynamic_parameters: {}
  });
  const [totalCombinations, setTotalCombinations] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSpecValid, setIsSpecValid] = useState(true);

  // Create a storage key specific to this workflow
  const storageKey = workflow ? `test-run-${workflow.id}` : '';

  const resetBatchSpec = useCallback(() => {
    setBatchSpec({
      static_parameters: {},
      dynamic_parameters: {}
    });
    setTotalCombinations(0);
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // Load saved batch spec when dialog opens
  useEffect(() => {
    if (open && workflow && storageKey) {
      const savedSpec = localStorage.getItem(storageKey);
      if (savedSpec) {
        try {
          const parsedSpec = JSON.parse(savedSpec);
          setBatchSpec(parsedSpec);
        } catch (e) {
          console.error('Failed to parse saved batch spec:', e);
          resetBatchSpec();
        }
      } else {
        resetBatchSpec();
      }
    }
  }, [open, workflow, storageKey, resetBatchSpec]);

  // Save batch spec to localStorage whenever it changes
  useEffect(() => {
    if (storageKey && Object.keys(batchSpec).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(batchSpec));
    }
  }, [batchSpec, storageKey]);

  const handleReset = () => {
    resetBatchSpec();
  };

  const handleSpecChange = useCallback((spec: BatchSpec, isValid: boolean) => {
    setBatchSpec(spec);
    setIsSpecValid(isValid);
  }, []);

  const handleBatchSubmit = async () => {
    if (!workflow || !batchSpec || totalCombinations === 0) return;
    
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/batch-execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchSpec),
      });

      const data = await response.json();
      if (data.success) {
        onOpenChange(false);
        if (onSubmit) {
          onSubmit();
        }
      } else {
        console.error('Failed to submit test run:', data.error);
        alert(`Failed to submit test run: ${data.error}`);
      }
    } catch (error) {
      console.error('Error submitting test run:', error);
      alert('Failed to submit test run execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between pr-10">
            <DialogTitle className="text-2xl font-bold">
              Test Run: {workflow.name}
            </DialogTitle>
            <Button variant="outline" onClick={handleReset} size="sm">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to Defaults
            </Button>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Configure and run a test suite for this workflow.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Batch Summary */}
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <h3 className="text-base font-semibold">Test Run Summary</h3>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs uppercase text-muted-foreground">Total Combinations:</span>
                    <span className="text-2xl font-bold">{totalCombinations}</span>
                    {totalCombinations > 500 && (
                      <span className="text-red-500 text-xs font-semibold">
                        (Exceeds limit of 500)
                      </span>
                    )}
                  </div>
                </div>
                <Button 
                  className="ml-4" 
                  size="default" 
                  disabled={totalCombinations === 0 || isSubmitting || totalCombinations > 500 || !isSpecValid}
                  onClick={handleBatchSubmit}
                >
                  {isSubmitting ? 'Submitting...' : `Queue ${totalCombinations} Execution${totalCombinations === 1 ? '' : 's'}`}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Variable Configurator */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Variable Configurator</CardTitle>
              <p className="text-sm text-muted-foreground">
                Define static values or iterate over multiple dynamic values for each parameter.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0 ? (
                <div className="max-h-[50vh] overflow-y-auto">
                  <BatchForm
                    schema={workflow.input_parameters as JsonObject}
                    initialValues={workflow.sample_inputs as JsonObject}
                    onSpecChange={handleSpecChange}
                    onCombinationsChange={setTotalCombinations}
                    initialSpec={batchSpec}
                  />
                </div>
              ) : (
                <p className="p-6">This workflow has no configurable parameters.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
} 