'use client';

import React, { useState, useRef, useMemo } from 'react';
import {
  WorkflowWithSettings,
  Execution,
  LiveExecutionStatus,
} from '@/lib/workflow-types';
import { AnimatedBadge } from '@/components/ui/animated-badge';
import { describeCronExpression } from '@/lib/cronParser';
import { ExecutionSparkline } from '@/components/ui/sparkline';
import {
  Clock,
  Play,
  MoreVertical,
  Activity,
  Eye,
  Calendar,
  Pause,
  Building2,
  Share2,
  AlertCircle,
  Trash2,
  Copy,
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
import { toast } from 'sonner';
import { cleanupDropdownClose } from '@/lib/ui-fixes';

interface WorkflowCardEnhancedProps {
  workflow: WorkflowWithSettings;
  executions: Execution[];
  liveExecutions?: LiveExecutionStatus[];
  isSelected?: boolean;
  onSelect?: () => void;
  onExecute?: () => void;
  onView?: () => void;
  onToggleCron?: () => void;
  onManageOrganizations?: () => void;
  onDelete?: (workflowId: number) => Promise<void>;
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
  onToggleCron,
  onManageOrganizations,
  onDelete,
  isMediarAdmin = false,
  className,
}: WorkflowCardEnhancedProps) {
  // Debug: Log cron fields for scheduled workflows
  if (workflow.cron_expression || workflow.cron_enabled) {
    console.log(
      `[WorkflowCard] ${workflow.id} ${workflow.name}: cron_expression=${workflow.cron_expression}, cron_enabled=${workflow.cron_enabled}`
    );
  }

  const [isHovered, setIsHovered] = useState(false);
  const [liveCountdown, setLiveCountdown] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Calculate metrics from workflow stats (not from limited executions array)
  const metrics = useMemo(() => {
    // Use current version success rate, default to 100% if not available
    const successRate = workflow.current_version_stats?.success_rate ?? 100;

    const avgDuration =
      workflow.current_version_stats?.average_duration_seconds ?? 0;
    const totalRuns = workflow.total_executions ?? 0;

    // Calculate trend from recent executions if available
    const trend =
      executions.length >= 2
        ? (() => {
            const duration0 =
              executions[0].execution_duration_seconds ||
              (executions[0].completed_at && executions[0].started_at
                ? (new Date(executions[0].completed_at).getTime() -
                    new Date(executions[0].started_at).getTime()) /
                  1000
                : 0);
            const duration1 =
              executions[1].execution_duration_seconds ||
              (executions[1].completed_at && executions[1].started_at
                ? (new Date(executions[1].completed_at).getTime() -
                    new Date(executions[1].started_at).getTime()) /
                  1000
                : 0);
            return duration0 > duration1 ? 'up' : 'down';
          })()
        : 'stable';

    return {
      successRate,
      avgDuration,
      totalRuns,
      trend,
    };
  }, [workflow, executions]);

  // Determine workflow status
  const getWorkflowStatus = () => {
    const hasLiveExecution = liveExecutions.some(
      le => le.workflow_id === workflow.id
    );
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

  // Live countdown timer for next execution
  React.useEffect(() => {
    if (!workflow.cron_enabled || !workflow.next_scheduled_execution) {
      setLiveCountdown('');
      return;
    }

    const updateCountdown = () => {
      if (!workflow.next_scheduled_execution) return;

      const nextRun = new Date(workflow.next_scheduled_execution);
      const now = new Date();
      const diffMs = nextRun.getTime() - now.getTime();

      if (diffMs < 0) {
        setLiveCountdown('overdue');
        return;
      }

      const diffSeconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(diffSeconds / 60);
      const seconds = diffSeconds % 60;

      if (minutes < 1) {
        setLiveCountdown(`${seconds}s`);
      } else if (minutes < 60) {
        setLiveCountdown(`${minutes}m ${seconds}s`);
      } else if (minutes < 1440) {
        const hours = nextRun.getHours();
        const mins = nextRun.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        setLiveCountdown(
          `${displayHours}:${mins.toString().padStart(2, '0')} ${ampm}`
        );
      } else {
        const days = Math.floor(minutes / 1440);
        setLiveCountdown(`${days}d`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [workflow.cron_enabled, workflow.next_scheduled_execution]);

  // Calculate cron schedule info for inline display
  const getNextRunInfo = useMemo(() => {
    if (!workflow.cron_expression) return null;

    // Get a short version of the cron description
    const fullDescription = describeCronExpression(workflow.cron_expression);

    // Simplify common patterns for inline display
    let shortDescription = fullDescription;
    if (fullDescription.includes('Every day at')) {
      const timeMatch = fullDescription.match(
        /at (\d{1,2}:\d{2}(?:\s?[AP]M)?)/i
      );
      shortDescription = timeMatch ? `Daily ${timeMatch[1]}` : 'Daily';
    } else if (fullDescription.includes('Every hour')) {
      const minuteMatch = fullDescription.match(/at (\d{1,2}) minutes?/);
      shortDescription = minuteMatch
        ? `Hourly :${minuteMatch[1].padStart(2, '0')}`
        : 'Hourly';
    } else if (fullDescription.includes('Every 5 minutes')) {
      shortDescription = 'Every 5m';
    } else if (fullDescription.includes('Every 15 minutes')) {
      shortDescription = 'Every 15m';
    } else if (fullDescription.includes('Every 30 minutes')) {
      shortDescription = 'Every 30m';
    } else if (fullDescription.includes('Every week')) {
      shortDescription = 'Weekly';
    } else if (fullDescription.includes('Every month')) {
      shortDescription = 'Monthly';
    }

    return {
      shortDescription,
      nextRunText: liveCountdown,
      isEnabled: workflow.cron_enabled,
    };
  }, [workflow.cron_expression, workflow.cron_enabled, liveCountdown]);

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (
      !confirm(
        `Are you sure you want to delete "${workflow.name}"? This will archive the workflow and preserve execution history.`
      )
    ) {
      return;
    }

    setIsDeleting(true);

    try {
      if (onDelete) {
        // Use parent callback
        await onDelete(workflow.id);
      } else {
        // Fallback to inline delete
        const response = await fetch(`/api/remote-workflows/${workflow.id}`, {
          method: 'DELETE',
        });
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to delete workflow');
        }

        toast.success(`Deleted workflow "${workflow.name}"`);
        setTimeout(() => {
          window.location.reload();
        }, 300);
      }
    } catch (err) {
      setIsDeleting(false);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to delete workflow: ${errorMessage}`);
    }
  };

  // Don't render if deleting (fade out)
  if (isDeleting) {
    return (
      <div
        className={cn(
          'animate-out fade-out-0 zoom-out-95 duration-200',
          'overflow-hidden transition-all',
          className
        )}
        style={{ maxHeight: '0px', opacity: 0 }}
      />
    );
  }

  return (
    <TooltipProvider>
      <div
        ref={cardRef}
        className={cn(
          'group relative bg-white transition-all duration-200 cursor-pointer',
          isHovered && 'bg-gray-50',
          isSelected && 'bg-gray-100',
          className
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => {
          onSelect?.();
          onView?.();
        }}
      >
        {/* Compact Card Content */}
        <div className="p-2">
          {/* Main Single Line */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Name and Status */}
            <div className="flex items-center gap-2 min-w-[200px] max-w-[320px] flex-shrink">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 truncate cursor-default">
                      {workflow.name}
                    </h3>
                    <span className="text-[11px] font-mono text-gray-400 flex-shrink-0">
                      #{workflow.id}
                    </span>
                    {workflow.uuid && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(workflow.uuid!);
                          toast.success('Workflow UUID copied to clipboard');
                        }}
                        title={`Copy UUID: ${workflow.uuid}`}
                        className="flex-shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    )}
                    {workflow.version_info?.current_version && (
                      <span className="text-[11px] font-mono text-gray-500 flex-shrink-0">
                        v{workflow.version_info.current_version}
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono text-xs">{workflow.name}</p>
                  <p className="font-mono text-xs text-gray-400 mt-1">
                    ID: {workflow.id}
                    {workflow.version_info?.current_version &&
                      ` • Version ${workflow.version_info.current_version}`}
                  </p>
                  {workflow.uuid && (
                    <p className="font-mono text-[11px] text-gray-400 mt-1">
                      UUID: {workflow.uuid}
                    </p>
                  )}
                  {workflow.tags && workflow.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-gray-400">Tags:</span>
                      {workflow.tags.map(tag => (
                        <span
                          key={tag}
                          className="text-[10px] font-mono bg-gray-700 text-white px-1 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
              {/* Only show status badge if it's meaningful (not deployed/running/paused) */}
              {status !== 'deployed' &&
                status !== 'running' &&
                status !== 'paused' && (
                  <AnimatedBadge
                    status={status as any}
                    className="text-xs py-0.5 px-2 flex-shrink-0"
                  >
                    {status.toUpperCase()}
                  </AnimatedBadge>
                )}
              {/* Show calendar icon with schedule info for cron workflows */}
              {workflow.cron_expression && workflow.cron_enabled && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex items-center gap-1 bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 flex-shrink-0">
                      <Calendar className="w-3 h-3 text-gray-600 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-gray-600 uppercase">
                        Scheduled
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-mono text-xs">
                      {describeCronExpression(workflow.cron_expression)}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Timezone: {workflow.cron_timezone || 'UTC'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {/* Show auto-paused indicator */}
              {workflow.cron_expression &&
                !workflow.cron_enabled &&
                workflow.cron_auto_paused && (
                  <Tooltip>
                    <TooltipTrigger>
                      <div className="flex items-center gap-1 bg-red-100 border border-red-600 rounded px-1.5 py-0.5 flex-shrink-0">
                        <AlertCircle className="w-3 h-3 text-red-800 flex-shrink-0" />
                        <span className="text-[10px] font-mono text-red-800 uppercase font-bold">
                          Auto-Paused
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs bg-red-50 border-red-600">
                      <p className="font-mono text-xs font-bold text-red-800">
                        Workflow automatically paused
                      </p>
                      <p className="text-[10px] text-red-700 mt-1">
                        {workflow.consecutive_failures} consecutive failures
                        detected
                      </p>
                      {workflow.auto_pause_reason && (
                        <p className="text-[10px] text-gray-600 mt-1 max-w-md">
                          {workflow.auto_pause_reason}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              {/* Show paused schedule indicator (manual pause) */}
              {workflow.cron_expression &&
                !workflow.cron_enabled &&
                !workflow.cron_auto_paused && (
                  <AnimatedBadge
                    status="paused"
                    className="text-xs py-0.5 px-2 flex-shrink-0"
                  >
                    PAUSED
                  </AnimatedBadge>
                )}
              {isMediarAdmin &&
                workflow.shared_with_orgs &&
                workflow.shared_with_orgs.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger>
                      <Share2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Shared with {workflow.shared_with_orgs.length} org
                        {workflow.shared_with_orgs.length > 1 ? 's' : ''}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
            </div>

            {/* Divider */}
            <div className="text-gray-300">|</div>

            {/* Metrics - Compact */}
            <div className="flex items-center gap-2 text-xs min-w-0">
              {/* Success Rate */}
              <div className="flex items-center gap-1">
                <span className="font-mono font-medium text-[11px]">
                  {metrics.successRate.toFixed(0)}%
                </span>
                <span className="text-gray-500 text-[11px]">success</span>
              </div>

              {/* Average Duration */}
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-gray-400" />
                <span className="font-mono font-medium text-[11px]">
                  {formatDuration(metrics.avgDuration)}
                </span>
              </div>

              {/* Total Runs */}
              <div className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-gray-400" />
                <span className="font-mono font-medium text-[11px]">
                  {metrics.totalRuns}
                </span>
              </div>

              {/* Show inline cron schedule or sparkline */}
              {getNextRunInfo ? (
                <>
                  <div className="flex items-center gap-1 ml-4">
                    <span className="text-[11px]">⏰</span>
                    <span
                      className={cn(
                        'font-mono text-[11px]',
                        !getNextRunInfo.isEnabled && 'text-gray-400'
                      )}
                    >
                      {getNextRunInfo.shortDescription}
                      {!getNextRunInfo.isEnabled && ' (paused)'}
                    </span>
                  </div>
                  {getNextRunInfo.isEnabled && getNextRunInfo.nextRunText && (
                    <>
                      <div className="text-gray-300">|</div>
                      <div className="flex items-center gap-1 mr-1">
                        <span className="text-gray-500 text-[11px]">Next:</span>
                        <span className="font-mono font-medium text-[11px]">
                          {getNextRunInfo.nextRunText}
                        </span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="ml-4 mr-1">
                  <ExecutionSparkline
                    executions={executions}
                    width={50}
                    height={16}
                  />
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={e => {
                  e.stopPropagation();
                  onExecute?.();
                }}
                className="h-6 px-1.5 text-[10px] border-black hover:bg-black hover:text-white whitespace-nowrap"
              >
                <Play className="w-3 h-3 mr-0.5" />
                Run
              </Button>

              {/* Action Menu */}
              <DropdownMenu
                modal={false}
                onOpenChange={open => {
                  if (!open) {
                    // Clean up when dropdown closes
                    cleanupDropdownClose();
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-gray-100"
                    onClick={e => e.stopPropagation()}
                  >
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={e => {
                      e.stopPropagation();
                      cleanupDropdownClose();
                      onExecute?.();
                    }}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Execute Now
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={e => {
                      e.stopPropagation();
                      cleanupDropdownClose();
                      onView?.();
                    }}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {workflow.cron_expression && (
                    <DropdownMenuItem
                      onClick={e => {
                        e.stopPropagation();
                        cleanupDropdownClose();
                        onToggleCron?.();
                      }}
                    >
                      {workflow.cron_enabled ? (
                        <>
                          <Pause className="mr-2 h-4 w-4" />
                          Pause Schedule
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          Resume Schedule
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  {isMediarAdmin && (
                    <>
                      <DropdownMenuItem
                        onClick={e => {
                          e.stopPropagation();
                          cleanupDropdownClose();
                          onManageOrganizations?.();
                        }}
                      >
                        <Building2 className="mr-2 h-4 w-4" />
                        Manage Organizations
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={e => {
                          cleanupDropdownClose();
                          handleDeleteClick(e);
                        }}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Workflow
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Optional Description Line */}
          {workflow.description && (
            <p className="mt-1 text-[11px] text-gray-600 line-clamp-1 pl-0">
              {workflow.description}
            </p>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
