'use client';

import React, { useState, useRef, useMemo } from 'react';
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
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  Zap,
  Calendar,
  ArrowRight,
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
  onEdit?: () => void;
  onDelete?: () => void;
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
  onEdit,
  onDelete,
  className,
}: WorkflowCardEnhancedProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
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
          const duration = 'duration' in e ? (e as any).duration : 0;
          return acc + (duration || 0);
        }, 0) / recentExecutions.length
      : 0;

    const trend = executions.length >= 2
      ? ('duration' in executions[0] && 'duration' in executions[1] &&
         (executions[0] as any).duration > (executions[1] as any).duration) ? 'up' : 'down'
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

  // Format duration
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <TooltipProvider>
      <div
        ref={cardRef}
        className={cn(
          'group relative bg-white rounded-xl border transition-all duration-200',
          isHovered && 'shadow-lg border-blue-300',
          isSelected && 'ring-2 ring-blue-500',
          'hover:border-gray-300',
          className
        )}
        onMouseEnter={() => {
          setIsHovered(true);
          setTimeout(() => setShowPreview(true), 500);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          setShowPreview(false);
        }}
        onClick={onSelect}
      >
        {/* Main Card Content */}
        <div className="p-6">
          {/* Header Row */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {workflow.name}
                </h3>
                <AnimatedBadge status={status as any}>
                  {status.toUpperCase()}
                </AnimatedBadge>
                {workflow.cron_expression && (
                  <Tooltip>
                    <TooltipTrigger>
                      <Calendar className="w-4 h-4 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Scheduled: {workflow.cron_expression}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <p className="text-sm text-gray-600 line-clamp-2">
                {workflow.description || 'No description provided'}
              </p>
            </div>

            {/* Action Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-4 w-4" />
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
                <DropdownMenuItem onClick={onEdit}>
                  Edit Workflow
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-red-600"
                >
                  Delete Workflow
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Metrics Row */}
          <div className="flex items-center gap-6 text-sm">
            {/* Success Rate */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {metrics.successRate >= 90 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : metrics.successRate >= 70 ? (
                  <Minus className="w-4 h-4 text-yellow-500" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                )}
                <span className="font-medium">
                  {metrics.successRate.toFixed(0)}%
                </span>
              </div>
              <span className="text-gray-500">success</span>
            </div>

            {/* Average Duration */}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="font-medium">
                {formatDuration(metrics.avgDuration)}
              </span>
              <span className="text-gray-500">avg</span>
            </div>

            {/* Total Runs */}
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" />
              <span className="font-medium">{metrics.totalRuns}</span>
              <span className="text-gray-500">runs</span>
            </div>

            {/* Execution Sparkline */}
            <div className="ml-auto">
              <ExecutionSparkline
                executions={executions}
                width={80}
                height={24}
              />
            </div>
          </div>

          {/* Quick Actions (visible on hover) */}
          <div className={cn(
            'mt-4 flex items-center gap-2 transition-all duration-200',
            isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}>
            <Button
              size="sm"
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                onExecute?.();
              }}
              className="flex items-center gap-1"
            >
              <Zap className="w-3 h-3" />
              Quick Run
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                onView?.();
              }}
            >
              Details
            </Button>
          </div>
        </div>

        {/* Hover Preview */}
        {showPreview && isHovered && (
          <div className="absolute left-full ml-4 top-0 z-50 w-64 p-4 bg-white rounded-lg shadow-xl border border-gray-200">
            <h4 className="font-semibold mb-2">Workflow Preview</h4>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">Type:</span>{' '}
                <span className="font-medium">{workflow.workflow_type}</span>
              </div>
              <div>
                <span className="text-gray-500">Version:</span>{' '}
                <span className="font-medium">{workflow.version}</span>
              </div>
              {workflow.cron_expression && (
                <div>
                  <span className="text-gray-500">Schedule:</span>{' '}
                  <span className="font-medium">{workflow.cron_expression}</span>
                </div>
              )}
              <div className="pt-2 border-t">
                <div className="text-gray-500 mb-1">Recent Activity</div>
                {executions.slice(0, 3).map((exec, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className={cn(
                      'w-2 h-2 rounded-full',
                      exec.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                    )} />
                    <span>{new Date(exec.created_at).toLocaleTimeString()}</span>
                    <ArrowRight className="w-3 h-3" />
                    <span>{formatDuration('duration' in exec ? (exec as any).duration || 0 : 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}