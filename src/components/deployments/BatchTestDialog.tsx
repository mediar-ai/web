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

  // Create a storage key specific to this workflow
  const storageKey = workflow ? `batch-test-${workflow.id}` : '';

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
        console.error('Failed to submit batch:', data.error);
        alert(`Failed to submit batch: ${data.error}`);
      }
    } catch (error) {
      console.error('Error submitting batch:', error);
      alert('Failed to submit batch execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl font-bold">
              Batch Test: {workflow.name}
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
            <CardHeader className="py-4">
              <CardTitle className="text-base">Batch Summary</CardTitle>
            </CardHeader>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-mono text-sm uppercase text-muted-foreground">Total Combinations</h3>
                  <p className="text-3xl font-bold">{totalCombinations}</p>
                </div>
                <Button 
                  className="ml-4" 
                  size="lg" 
                  disabled={totalCombinations === 0 || isSubmitting || totalCombinations > 500}
                  onClick={handleBatchSubmit}
                >
                  {isSubmitting ? 'Submitting...' : `Queue ${totalCombinations} Execution${totalCombinations === 1 ? '' : 's'}`}
                </Button>
              </div>
              {totalCombinations > 500 && (
                <p className="text-red-500 text-xs mt-2 font-semibold">
                  Warning: Batch size exceeds the limit of 500.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Variable Configurator */}
          <Card>
            <CardHeader className="py-4">
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
                    onSpecChange={setBatchSpec}
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