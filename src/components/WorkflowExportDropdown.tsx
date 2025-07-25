'use client';

import React, { useState } from 'react';
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

    setExportingWorkflowId(workflow.id);
    
    try {
      console.log(`🔄 Exporting workflow: ${workflow.title} (ID: ${workflow.id})`);
      
      const response = await fetch('/api/workflows/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          workflowId: workflow.id,
          selectedWorkflowName: workflow.title
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to export workflow');
      }

      const result = await response.json();
      
      if (result.success) {
        // Create and trigger download
        const blob = new Blob([result.content], { type: 'text/yaml' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        console.log(`✅ Successfully exported workflow: ${workflow.title}`);
        console.log(`📊 Export metadata:`, result.metadata);
        
        setIsOpen(false); // Close dropdown after successful export
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      console.error('Error exporting workflow:', error);
      // You could add a toast notification here if available
      alert(`Failed to export workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
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
                Exports as YAML with timeline mapping and context
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