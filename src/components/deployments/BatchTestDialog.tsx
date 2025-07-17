'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Database } from 'lucide-react';

import { BatchForm } from '@/components/deployments/BatchForm';
import { CacheResultsPopup } from '@/components/deployments/CacheResultsPopup';
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
  
  // Cache-related state
  const [cacheResult, setCacheResult] = useState<{
    cached: boolean;
    cache_hit_id?: number;
    status?: 'completed' | 'failed';
    quotes_found?: number;
    execution_duration_seconds?: number;
    error_message?: string;
    created_at?: string;
    cache_source?: 'hash' | 'jsonb';
    query_time?: number;
  } | null>(null);
  const [showCachePopup, setShowCachePopup] = useState(false);
  const [isCheckingCache, setIsCheckingCache] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<'pending' | 'queued' | 'running' | 'completed' | 'failed'>('pending');

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



  const handleSpecChange = useCallback((spec: BatchSpec, isValid: boolean) => {
    setBatchSpec(spec);
    setIsSpecValid(isValid);
  }, []);

  // Cache lookup function
  const checkCache = useCallback(async (parameters: JsonObject) => {
    if (!workflow) return null;
    
    setIsCheckingCache(true);
    try {
      const response = await fetch(`/api/remote-workflows/cache?workflow_id=${workflow.id}&detailed_output=false`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters }),
      });

      const data = await response.json();
      console.log('🎯 Cache lookup result:', data);
      
      if (data.success && data.cached) {
        return data;
      }
    } catch (error) {
      console.error('❌ Cache lookup error:', error);
    } finally {
      setIsCheckingCache(false);
    }
    return null;
  }, [workflow]);

  const handleBatchSubmit = async () => {
    if (!workflow || !batchSpec || totalCombinations === 0) return;
    
    console.log('🚀 BatchTestDialog: Submitting batch with spec:', batchSpec);
    console.log('🔢 BatchTestDialog: Total combinations:', totalCombinations);
    
    setIsSubmitting(true);
    setExecutionStatus('pending');
    
    // First, check cache for single-parameter executions
    if (totalCombinations === 1) {
      const parameters = { ...batchSpec.static_parameters };
      // Add dynamic parameters (should only be single values for combination count = 1)
      Object.entries(batchSpec.dynamic_parameters).forEach(([key, values]) => {
        if (values.length > 0) {
          parameters[key] = values[0];
        }
      });
      
      // Check cache first
      const cacheHit = await checkCache(parameters);
      if (cacheHit) {
        setCacheResult(cacheHit);
        setShowCachePopup(true);
        console.log('💾 Cache hit found, showing results while executing live...');
      }
    }
    
    try {
      setExecutionStatus('queued');
      const response = await fetch(`/api/remote-workflows/${workflow.id}/batch-execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchSpec),
      });

      const data = await response.json();
      console.log('📡 BatchTestDialog: Server response:', data);
      
      if (data.success) {
        console.log('✅ BatchTestDialog: Batch submission successful');
        console.log('🎯 BatchTestDialog: Execution IDs:', data.execution_ids);
        setExecutionStatus('running');
        
        // Only close dialog if we didn't show cache results
        if (!showCachePopup) {
          onOpenChange(false);
        }
        
        if (onSubmit) {
          onSubmit();
        }
      } else {
        console.error('❌ BatchTestDialog: Failed to submit test run:', data.error);
        alert(`Failed to submit test run: ${data.error}`);
      }
    } catch (error) {
      console.error('❌ BatchTestDialog: Error submitting test run:', error);
      alert('Failed to submit test run execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border-black">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-2xl font-bold">
            Test Run: {workflow.name}
          </DialogTitle>
          <p className="text-muted-foreground text-sm mt-1">
            Configure and run a test suite for this workflow.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Batch Summary */}
          <Card className="border-black">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <h3 className="text-base font-semibold">Test Run Summary</h3>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs uppercase text-muted-foreground">Total Combinations:</span>
                    <span className="text-2xl font-bold">{totalCombinations}</span>
                    {totalCombinations > 5000 && (
                      <span className="text-red-500 text-xs font-semibold">
                        (Exceeds limit of 5000)
                      </span>
                    )}
                  </div>
                </div>
                <Button 
                  className="ml-4" 
                  size="default" 
                  disabled={totalCombinations === 0 || isSubmitting || totalCombinations > 5000 || !isSpecValid || isCheckingCache}
                  onClick={handleBatchSubmit}
                >
                  {isCheckingCache ? (
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Checking Cache...
                    </div>
                  ) : isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </div>
                  ) : (
                    `Queue ${totalCombinations} Execution${totalCombinations === 1 ? '' : 's'}`
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Variable Configurator */}
          <Card className="border-black">
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
      
      {/* Cache Results Popup */}
      <CacheResultsPopup
        cacheResult={cacheResult}
        isVisible={showCachePopup}
        executionStatus={executionStatus}
        onClose={() => setShowCachePopup(false)}
      />
    </Dialog>
  );
} 