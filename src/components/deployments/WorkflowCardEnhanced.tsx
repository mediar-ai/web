'use client';

import React, { useState, useRef, useMemo } from 'react';
import cronstrue from 'cronstrue';
import {
  WorkflowWithSettings,
  Execution,
  LiveExecutionStatus
} from '@/lib/workflow-types';
import { AnimatedBadge } from '@/components/ui/animated-badge';
import { ExecutionSparkline } from '@/components/ui/sparkline';
import {
  Clock,
  Play,
  MoreVertical,
  Activity,
  Eye,
  Zap,
  Calendar,
  Pause,
  Trash2,
  Building2,
  Share2,
  Copy,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface WorkflowCardEnhancedProps {
  workflow: WorkflowWithSettings;
  executions: Execution[];
  liveExecutions?: LiveExecutionStatus[];
  isSelected?: boolean;
  onSelect?: () => void;
  onExecute?: () => void;
  onView?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onToggleCron?: () => void;
  onManageOrganizations?: () => void;
  onUploadVersion?: () => void;
  isMediarAdmin?: boolean;
  className?: string;
}

export function WorkflowCardEnhanced({
  workflow,
  executions,
  liveExecutions = [],
  isSelected = false,
  onSelect,
  onExecute,
  onView,
  onDuplicate,
  onDelete,
  onToggleCron,
  onManageOrganizations,
  onUploadVersion,
  isMediarAdmin = false,
  className,
}: WorkflowCardEnhancedProps) {
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Calculate metrics
  const metrics = useMemo(() => {
    const recentExecutions = executions.slice(0, 10);
    const successCount = recentExecutions.filter(
      e => e.status === 'completed'
    ).length;
    const successRate = recentExecutions.length > 0
      ? (successCount / recentExecutions.length) * 100
      : 0;

    const avgDuration = recentExecutions.length > 0
      ? recentExecutions.reduce((acc, e) => {
          // Use execution_duration_seconds if available, otherwise calculate from timestamps
          if (e.execution_duration_seconds) {
            return acc + e.execution_duration_seconds;
          } else if (e.completed_at && e.started_at) {
            const duration = (new Date(e.completed_at).getTime() - new Date(e.started_at).getTime()) / 1000;
            return acc + duration;
          }
          return acc;
        }, 0) / recentExecutions.length
      : 0;

    const trend = executions.length >= 2
      ? (() => {
          const duration0 = executions[0].execution_duration_seconds ||
            (executions[0].completed_at && executions[0].started_at ?
              (new Date(executions[0].completed_at).getTime() - new Date(executions[0].started_at).getTime()) / 1000 : 0);
          const duration1 = executions[1].execution_duration_seconds ||
            (executions[1].completed_at && executions[1].started_at ?
              (new Date(executions[1].completed_at).getTime() - new Date(executions[1].started_at).getTime()) / 1000 : 0);
          return duration0 > duration1 ? 'up' : 'down';
        })()
      : 'stable';

    return {
      successRate,
      avgDuration,
      totalRuns: executions.length,
      trend,
    };
  }, [executions]);

  // Determine workflow status
  const getWorkflowStatus = () => {
    const hasLiveExecution = liveExecutions.some(le => le.workflow_id === workflow.id);
    if (hasLiveExecution) return 'running';
    if (workflow.cron_expression && !workflow.cron_enabled) return 'paused';
    if (workflow.status === 'deployed') return 'deployed';
    return workflow.status;
  };

  const status = getWorkflowStatus();

  // Format duration (input is in seconds)
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds === 0) return '0s';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <TooltipProvider>
      <div
        ref={cardRef}
        className={cn(
          'group relative bg-white border border-black transition-all duration-200',
          isHovered && 'shadow-md',
          isSelected && 'border-2',
          'hover:shadow-sm',
          className
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onSelect}
      >
        {/* Compact Card Content */}
        <div className="p-3">
          {/* Main Single Line */}
          <div className="flex items-center gap-3">
            {/* Name and Status */}
            <div className="flex items-center gap-2 min-w-0 flex-shrink">
              <h3 className="text-sm font-semibold text-gray-900 truncate">
                {workflow.name}
              </h3>
              <AnimatedBadge status={status as any} className="text-xs py-0.5 px-2">
                {status.toUpperCase()}
              </AnimatedBadge>
              {workflow.cron_expression && (
                <Tooltip>
                  <TooltipTrigger>
                    <Calendar className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{(() => {
                      try {
                        return cronstrue.toString(workflow.cron_expression || '', { verbose: false });
                      } catch {
                        return `Schedule: ${workflow.cron_expression}`;
                      }
                    })()}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {isMediarAdmin && workflow.shared_with_orgs && workflow.shared_with_orgs.length > 0 && (
                <Tooltip>
                  <TooltipTrigger>
                    <Share2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Shared with {workflow.shared_with_orgs.length} org{workflow.shared_with_orgs.length > 1 ? 's' : ''}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Divider */}
            <div className="text-gray-300">|</div>

            {/* Metrics - Compact */}
            <div className="flex items-center gap-4 text-xs flex-1">
              {/* Success Rate */}
              <div className="flex items-center gap-1">
                <span className="font-mono font-medium">
                  {metrics.successRate.toFixed(0)}%
                </span>
                <span className="text-gray-500">success</span>
              </div>

              {/* Average Duration */}
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-gray-400" />
                <span className="font-mono font-medium">
                  {formatDuration(metrics.avgDuration)}
                </span>
                <span className="text-gray-500">avg</span>
              </div>

              {/* Total Runs */}
              <div className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-gray-400" />
                <span className="font-mono font-medium">{metrics.totalRuns}</span>
                <span className="text-gray-500">runs</span>
              </div>

              {/* Execution Sparkline */}
              <div className="ml-auto mr-2">
                <ExecutionSparkline
                  executions={executions}
                  width={60}
                  height={20}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute?.();
                }}
                className="h-7 px-2 text-xs border-black hover:bg-black hover:text-white"
              >
                <Zap className="w-3 h-3 mr-1" />
                Run
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onView?.();
                }}
                className="h-7 px-2 text-xs border-black hover:bg-black hover:text-white"
              >
                <Eye className="w-3 h-3 mr-1" />
                View
              </Button>

              {/* Action Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 hover:bg-gray-100"
                  >
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onExecute}>
                    <Play className="mr-2 h-4 w-4" />
                    Execute Now
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onView}>
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {workflow.cron_expression && (
                    <DropdownMenuItem onClick={onToggleCron}>
                      {workflow.cron_enabled ? (
                        <><Pause className="mr-2 h-4 w-4" />Pause Schedule</>
                      ) : (
                        <><Play className="mr-2 h-4 w-4" />Resume Schedule</>
                      )}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={onDuplicate}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onUploadVersion}>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Version
                  </DropdownMenuItem>
                  {isMediarAdmin && (
                    <DropdownMenuItem onClick={onManageOrganizations}>
                      <Building2 className="mr-2 h-4 w-4" />
                      Manage Organizations
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="hover:bg-black hover:text-white"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Optional Description Line */}
          {workflow.description && (
            <p className="mt-2 text-xs text-gray-600 line-clamp-1 pl-0">
              {workflow.description}
            </p>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}