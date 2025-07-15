'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Loader2, Settings } from 'lucide-react';
import { Workflow } from '@/lib/workflow-types';

interface SettingsWorkflowCardProps {
  workflow: Workflow;
  onFetchDetails: (workflowId: number) => void;
  loadingDetails: boolean;
}

const getStatusBadge = (status: string) => {
  // Using consistent black and white design to match WorkflowCard
  const statusStyles: Record<string, string> = {
    deployed: 'bg-black text-white border border-black', // Active status - filled black
    pending: 'bg-white text-black border border-black', // Default outline
    draft: 'bg-white text-black border border-black', // Default outline
    paused: 'bg-white text-black border border-black font-bold', // Bold text for emphasis
    failed: 'bg-white text-black border border-black font-bold', // Bold text for emphasis
    inactive: 'bg-gray-100 text-gray-600 border border-black' // Slightly muted
  };
  return statusStyles[status] || 'bg-white text-black border border-black';
};

export function SettingsWorkflowCard({
  workflow,
  onFetchDetails,
  loadingDetails,
}: SettingsWorkflowCardProps) {
  return (
    <div className="ml-4 border border-black pl-4 py-2 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Settings className="w-4 h-4 text-black" />
            <h5 className="text-sm font-semibold font-mono text-black truncate">
              {workflow.name}
            </h5>
            <span className="text-xs font-mono px-2 py-0.5 bg-white text-black border border-black rounded">
              v{workflow.version || '1.0.0'}
            </span>
            <Badge className={`${getStatusBadge(workflow.status)} text-xs h-5 px-2`}>
              SETTINGS
            </Badge>
          </div>
          
          {workflow.description && (
            <p className="text-xs text-black truncate max-w-md">
              {workflow.description}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-2 ml-4">
          <Button 
            onClick={() => onFetchDetails(workflow.id)}
            variant="outline"
            size="sm"
            className="h-7 px-3 text-xs font-mono border-black hover:bg-gray-100"
            disabled={loadingDetails}
          >
            {loadingDetails ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
            <span className="ml-1">CONFIG</span>
          </Button>
        </div>
      </div>
    </div>
  );
} 