'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface WorkflowItem {
  id: number;
  title: string;
  created_at: string;
}

interface WorkflowExportDropdownProps {
  workflows: WorkflowItem[];
  userId: string;
  disabled?: boolean;
}

export function WorkflowExportDropdown({ workflows, userId, disabled = false }: WorkflowExportDropdownProps) {
  const [exportingWorkflowId, setExportingWorkflowId] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleExportWorkflow = async (workflow: WorkflowItem) => {
    if (exportingWorkflowId) return; // Prevent multiple exports

    const exportStartTime = Date.now();
    const exportId = `ui_export_${workflow.id}_${exportStartTime}`;

    console.log('🚀 [UI-EXPORT] Starting workflow export from UI:', {
      exportId,
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      userId,
      timestamp: new Date().toISOString()
    });

    setExportingWorkflowId(workflow.id);
    
    try {
      console.log(`🔄 [UI-EXPORT] Exporting workflow: ${workflow.title} (ID: ${workflow.id})`, {
        exportId
      });

      const requestPayload = {
        userId: userId,
        workflowId: workflow.id,
        selectedWorkflowName: workflow.title
      };

      console.log('📤 [UI-EXPORT] Sending API request:', {
        exportId,
        endpoint: '/api/workflows/export',
        method: 'POST',
        payload: requestPayload
      });

      const apiStartTime = Date.now();
      const response = await fetch('/api/workflows/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      const apiTime = Date.now() - apiStartTime;

      console.log('📥 [UI-EXPORT] API response received:', {
        exportId,
        responseStatus: response.status,
        responseOk: response.ok,
        apiTimeMs: apiTime
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[ERROR] [UI-EXPORT] API request failed:', {
          exportId,
          status: response.status,
          statusText: response.statusText,
          errorData,
          apiTimeMs: apiTime
        });
        throw new Error(errorData.error || 'Failed to export workflow');
      }

      const result = await response.json();
      
      console.log('[STATS] [UI-EXPORT] Export result received:', {
        exportId,
        success: result.success,
        filename: result.filename,
        contentLength: result.content?.length || 0,
        metadata: result.metadata,
        apiTimeMs: apiTime
      });

      if (result.success) {
        // Create and trigger download
        console.log('[DB] [UI-EXPORT] Creating download blob...', {
          exportId,
          filename: result.filename,
          contentType: 'text/yaml'
        });

        const blob = new Blob([result.content], { type: 'text/yaml' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        const totalTime = Date.now() - exportStartTime;

        console.log(`[SUCCESS] [UI-EXPORT] Successfully exported workflow: ${workflow.title}`, {
          exportId,
          filename: result.filename,
          totalTimeMs: totalTime,
          apiTimeMs: apiTime,
          downloadTriggered: true
        });
        
        if (result.metadata) {
          console.log(`[STATS] [UI-EXPORT] Export metadata:`, {
            exportId,
            ...result.metadata
          });
        }
        
        setIsOpen(false); // Close dropdown after successful export
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      const errorTime = Date.now() - exportStartTime;
      
      console.error('💥 [UI-EXPORT] Export failed with error:', {
        exportId,
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
        totalTimeMs: errorTime,
        timestamp: new Date().toISOString()
      });

      toast.error(`Failed to export workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      console.log('🏁 [UI-EXPORT] Export process finished:', {
        exportId,
        workflowId: workflow.id,
        success: exportingWorkflowId === workflow.id
      });
      
      setExportingWorkflowId(null);
    }
  };

  if (workflows.length === 0) {
    return (
      <Button variant="outline" disabled className="flex items-center gap-2">
        <FileText className="h-4 w-4" />
        No Workflows to Export
      </Button>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          disabled={disabled || exportingWorkflowId !== null}
          className="flex items-center gap-2 border-black-outline"
        >
          <Download className="h-4 w-4" />
          Export Workflow
          {exportingWorkflowId && <RefreshCw className="h-4 w-4 animate-spin" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 border-black-outline">
        <DropdownMenuLabel>Select Workflow to Export</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {workflows.map((workflow) => (
            <DropdownMenuItem
              key={workflow.id}
              onClick={() => handleExportWorkflow(workflow)}
              disabled={exportingWorkflowId !== null}
              className="flex flex-col items-start gap-1 p-3 cursor-pointer hover:bg-muted/50"
            >
              <div className="flex items-center justify-between w-full">
                <span className="font-medium text-sm truncate">
                  {workflow.title || `Workflow ${workflow.id}`}
                </span>
                {exportingWorkflowId === workflow.id && (
                  <RefreshCw className="h-3 w-3 animate-spin ml-2" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Created: {new Date(workflow.created_at).toLocaleDateString()}
              </span>
              <div className="text-xs text-muted-foreground mt-1">
                Exports as YAML with timeline annotation and context
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {workflows.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-xs text-muted-foreground">
              {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} available for export
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 