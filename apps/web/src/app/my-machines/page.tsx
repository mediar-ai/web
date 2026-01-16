'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Monitor,
  Play,
  Square,
  Trash2,
  Loader2,
  RefreshCw,
  Plus,
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Maximize2,
  X,
  Radio,
  Zap,
  Timer,
  Cpu,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LaunchVmDialog } from '@/components/vm/LaunchVmDialog';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { VNC_GATEWAY_URL } from '@/lib/azure';

// Trial sandbox lifecycle constants
const TRIAL_CONFIG = {
  autoStopMinutes: 30,   // Auto-stop after 30min idle
  autoDeleteHours: 24,   // Deleted after 24 hours
};

// VM size display info
const VM_SIZE_INFO: Record<string, { name: string; vcpu: number; ram: string; costPerHour: number }> = {
  'Standard_D2s_v3': { name: 'Starter', vcpu: 2, ram: '8GB', costPerHour: 12 },
  'Standard_D4s_v3': { name: 'Standard', vcpu: 4, ram: '16GB', costPerHour: 24 },
  'Standard_D8s_v3': { name: 'Performance', vcpu: 8, ram: '32GB', costPerHour: 48 },
};

// Helper to extract trial status from tags
function isTrial(tags?: string[]): boolean {
  return tags?.some(t => t === 'trial:true') ?? false;
}

// Helper to extract VM size from tags
function getVmSize(tags?: string[]): string | null {
  const sizeTag = tags?.find(t => t.startsWith('vmSize:'));
  return sizeTag?.replace('vmSize:', '') ?? null;
}

// Helper to get time remaining until auto-delete for trial VMs
function getTrialTimeRemaining(createdAt: string): { hours: number; minutes: number; isExpiringSoon: boolean } {
  const created = new Date(createdAt);
  const deleteAt = new Date(created.getTime() + TRIAL_CONFIG.autoDeleteHours * 60 * 60 * 1000);
  const now = new Date();
  const remainingMs = deleteAt.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return { hours: 0, minutes: 0, isExpiringSoon: true };
  }

  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  const isExpiringSoon = hours < 2; // Less than 2 hours remaining

  return { hours, minutes, isExpiringSoon };
}

interface Machine {
  id: number;
  name: string;
  status: string;
  health_status: string;
  region: string;
  machine_type: string;
  provisioning_step: string | null;
  created_at: string;
  provisioned_at: string | null;
  terraform_key?: string;
  mcp_endpoint?: string;
  tags?: string[];
}

export default function MyMachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [launchVmOpen, setLaunchVmOpen] = useState(false);
  const [userCredits, setUserCredits] = useState(0);
  const [fullscreenMachine, setFullscreenMachine] = useState<Machine | null>(null);

  const fetchMachines = useCallback(async () => {
    try {
      const response = await fetch('/api/user/machines');
      const data = await response.json();
      if (data.machines) {
        setMachines(data.machines);
      }
    } catch (err) {
      console.error('Failed to fetch machines:', err);
      toast.error('Failed to load machines');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchUserCredits = useCallback(async () => {
    try {
      const response = await fetch('/api/user/credits');
      const data = await response.json();
      if (data.balance !== undefined) {
        setUserCredits(data.balance);
      }
    } catch (err) {
      console.error('Failed to fetch credits:', err);
    }
  }, []);

  // Check if any machine is transitioning (starting/stopping)
  const hasTransitioningMachine = machines.some(m =>
    ['stopping', 'starting', 'deallocating'].includes(m.status?.toLowerCase() || '')
  );

  useEffect(() => {
    fetchMachines();
    fetchUserCredits();

    // Poll faster (5s) when machines are transitioning, otherwise every 30s
    const pollInterval = hasTransitioningMachine ? 5000 : 30000;
    const interval = setInterval(fetchMachines, pollInterval);
    return () => clearInterval(interval);
  }, [fetchMachines, fetchUserCredits, hasTransitioningMachine]);

  const handleStart = async (machineId: number) => {
    setActionLoading(machineId);
    try {
      const response = await fetch(`/api/user/machines/${machineId}/start`, {
        method: 'POST',
      });
      const data = await response.json();
      if (response.ok) {
        toast.success(data.message);
        fetchMachines();
      } else {
        toast.error(data.error || 'Failed to start machine');
      }
    } catch {
      toast.error('Failed to start machine');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (machineId: number) => {
    setActionLoading(machineId);
    try {
      const response = await fetch(`/api/user/machines/${machineId}/stop`, {
        method: 'POST',
      });
      const data = await response.json();
      if (response.ok) {
        toast.success(data.message);
        fetchMachines();
      } else {
        toast.error(data.error || 'Failed to stop machine');
      }
    } catch {
      toast.error('Failed to stop machine');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (machineId: number, machineName: string) => {
    if (!confirm(`Are you sure you want to delete "${machineName}"? This cannot be undone.`)) {
      return;
    }

    setActionLoading(machineId);
    try {
      const response = await fetch(`/api/user/machines/${machineId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (response.ok) {
        toast.success(data.message);
        fetchMachines();
      } else {
        toast.error(data.error || 'Failed to delete machine');
      }
    } catch {
      toast.error('Failed to delete machine');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusDisplay = (machine: Machine) => {
    const status = machine.status?.toLowerCase() || 'unknown';
    // Check if provisioning is in progress (inactive status with provisioning_step not done)
    const isProvisioning = status === 'inactive' && machine.provisioning_step;

    if (isProvisioning) {
      let step = null;
      if (machine.provisioning_step) {
        try {
          step = typeof machine.provisioning_step === 'string'
            ? JSON.parse(machine.provisioning_step)
            : machine.provisioning_step;
        } catch {
          step = null;
        }
      }
      return {
        label: step?.message || 'Provisioning...',
        color: 'text-gray-600',
        bg: 'bg-gray-100',
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
      };
    }

    switch (status) {
      case 'active':
        return {
          label: 'Running',
          color: 'text-black',
          bg: 'bg-black text-white',
          icon: <CheckCircle2 className="h-4 w-4" />,
        };
      case 'starting':
        return {
          label: 'Starting...',
          color: 'text-gray-600',
          bg: 'bg-gray-100',
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
        };
      case 'stopping':
      case 'deallocating':
        return {
          label: 'Stopping...',
          color: 'text-gray-600',
          bg: 'bg-gray-100',
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
        };
      case 'stopped':
      case 'inactive':
      case 'deallocated':
        return {
          label: 'Stopped',
          color: 'text-gray-500',
          bg: 'bg-gray-200',
          icon: <Square className="h-4 w-4" />,
        };
      case 'error':
        return {
          label: 'Error',
          color: 'text-red-600',
          bg: 'bg-red-100',
          icon: <AlertCircle className="h-4 w-4" />,
        };
      default:
        return {
          label: status,
          color: 'text-gray-500',
          bg: 'bg-gray-100',
          icon: <Clock className="h-4 w-4" />,
        };
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getVncUrl = (machine: Machine) => {
    // VNC gateway looks up VMs by terraform:{key} tag or terraform_key
    const tagKey = machine.tags
      ?.find(t => t.startsWith('terraform:'))
      ?.replace('terraform:', '');
    const terraformKey =
      machine.terraform_key && !machine.terraform_key.startsWith('dashboard-')
        ? machine.terraform_key
        : null;
    const key = tagKey || terraformKey;
    if (!key) return null;
    return `${VNC_GATEWAY_URL}/vnc/${key}`;
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-mono font-bold flex items-center gap-3">
              <Monitor className="h-8 w-8" />
              AGENT SANDBOXES
            </h1>
            <p className="text-gray-600 mt-1">
              Secure cloud environments for your AI agents
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="black-outline"
              onClick={() => fetchMachines()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              onClick={() => setLaunchVmOpen(true)}
              className="bg-black text-white hover:bg-gray-800 gap-2"
            >
              <Plus className="h-4 w-4" />
              New Sandbox
            </Button>
          </div>
        </div>

        {/* Sandboxes List */}
        {machines.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
            <Monitor className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <h2 className="text-xl font-mono font-bold mb-2">No sandboxes yet</h2>
            <p className="text-gray-500 mb-6">
              Launch an agent sandbox to run your workflows in the cloud
            </p>
            <Button
              onClick={() => setLaunchVmOpen(true)}
              className="bg-black text-white hover:bg-gray-800 gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Your First Sandbox
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {machines.map(machine => {
              const statusDisplay = getStatusDisplay(machine);
              const status = machine.status?.toLowerCase() || 'unknown';
              const isRunning = status === 'active';

              // Check if provisioning is in progress (not done/completed)
              const isProvisioning = (() => {
                if (!machine.provisioning_step) return false;
                try {
                  const step = typeof machine.provisioning_step === 'string'
                    ? JSON.parse(machine.provisioning_step)
                    : machine.provisioning_step;
                  return step.step !== 'done' && step.status !== 'completed';
                } catch {
                  return false;
                }
              })();

              const isStopped = ['stopped', 'inactive', 'deallocated'].includes(status) && !isProvisioning;
              const isTransitioning = ['stopping', 'starting', 'deallocating'].includes(status) || isProvisioning;
              const canStart = isStopped;
              const canStop = isRunning;
              const isActionLoading = actionLoading === machine.id || isTransitioning;
              // Allow delete during provisioning - user should be able to cancel stuck provisioning jobs
              const isDeleteLoading = actionLoading === machine.id;
              const vncUrl = getVncUrl(machine);

              // Extract trial and size info from tags
              const isTrialSandbox = isTrial(machine.tags);
              const vmSize = getVmSize(machine.tags);
              const sizeInfo = vmSize ? VM_SIZE_INFO[vmSize] : null;
              const trialTimeRemaining = isTrialSandbox ? getTrialTimeRemaining(machine.created_at) : null;

              return (
                <div
                  key={machine.id}
                  className="border-2 border-black bg-white flex flex-col"
                >
                  {/* Header */}
                  <div className={cn(
                    'flex items-center justify-between p-4 gap-4',
                    isRunning ? 'bg-black text-white' : 'bg-gray-100'
                  )}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={cn(
                        'p-2 rounded flex-shrink-0',
                        isRunning ? 'bg-white text-black' : 'bg-gray-200'
                      )}>
                        <Monitor className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3
                            className="font-mono font-bold truncate max-w-[180px]"
                            title={machine.name}
                          >
                            {machine.name}
                          </h3>
                          {isTrialSandbox && (
                            <span className={cn(
                              'px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase rounded flex-shrink-0',
                              isRunning ? 'bg-white text-black' : 'bg-black text-white'
                            )}>
                              <Zap className="h-2.5 w-2.5 inline mr-0.5" />
                              Trial
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs opacity-70 mt-0.5">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {machine.region}
                          </span>
                          {sizeInfo && (
                            <span className="flex items-center gap-1">
                              <Cpu className="h-3 w-3" />
                              {sizeInfo.vcpu} vCPU · {sizeInfo.ram}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'px-2.5 py-1.5 rounded text-xs font-mono flex items-center gap-1.5 flex-shrink-0 max-w-[200px]',
                        isRunning ? 'bg-white text-black' : statusDisplay.bg
                      )}
                      title={statusDisplay.label}
                    >
                      {statusDisplay.icon}
                      <span className="truncate">{statusDisplay.label}</span>
                    </div>
                  </div>

                  {/* Trial lifecycle info banner */}
                  {isTrialSandbox && trialTimeRemaining && (
                    <div className={cn(
                      'px-4 py-2 text-xs font-mono border-b flex items-center justify-between gap-2',
                      trialTimeRemaining.isExpiringSoon
                        ? 'bg-gray-100 border-gray-300'
                        : 'bg-gray-50 border-gray-200'
                    )}>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Timer className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className={trialTimeRemaining.isExpiringSoon ? 'font-bold' : ''}>
                          {trialTimeRemaining.hours}h {trialTimeRemaining.minutes}m until auto-delete
                        </span>
                      </div>
                      <div className="text-gray-500 flex items-center gap-1.5 whitespace-nowrap">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        <span>{TRIAL_CONFIG.autoStopMinutes}min idle → auto-stop</span>
                      </div>
                    </div>
                  )}

                  {/* Screen View */}
                  <div className="relative flex-1 min-h-[280px] bg-gray-900">
                    {isRunning && vncUrl ? (
                      <>
                        {/* Live indicator */}
                        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 px-2 py-1 bg-black/80 text-white text-xs font-mono rounded">
                          <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                          LIVE
                        </div>
                        {/* Fullscreen button */}
                        <button
                          onClick={() => setFullscreenMachine(machine)}
                          className="absolute top-2 right-2 z-10 p-1.5 bg-black/80 text-white hover:bg-black transition-colors rounded"
                          title="Fullscreen"
                        >
                          <Maximize2 className="h-4 w-4" />
                        </button>
                        {/* VNC iframe */}
                        <iframe
                          src={vncUrl}
                          className="w-full h-full border-0"
                          allow="clipboard-read; clipboard-write"
                        />
                      </>
                    ) : isRunning ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <Loader2 className="h-8 w-8 animate-spin mb-2" />
                        <span className="text-sm font-mono">Connecting to screen...</span>
                      </div>
                    ) : isTransitioning ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400 px-4">
                        <Loader2 className="h-8 w-8 animate-spin mb-3" />
                        <span
                          className="text-sm font-mono text-center max-w-[280px] truncate"
                          title={statusDisplay.label}
                        >
                          {statusDisplay.label}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <Monitor className="h-12 w-12 mb-2 opacity-50" />
                        <span className="text-sm font-mono">Sandbox is stopped</span>
                        <span className="text-xs text-gray-400 mt-1">Click Start to power on</span>
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div className="p-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                    <div className="text-xs text-gray-500 font-mono space-y-0.5">
                      <div>Created {formatDate(machine.created_at)}</div>
                      {!isTrialSandbox && sizeInfo && isRunning && (
                        <div className="text-gray-400">
                          ~{sizeInfo.costPerHour} credits/hr while running
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canStart && (
                        <Button
                          variant="black-outline"
                          size="sm"
                          onClick={() => handleStart(machine.id)}
                          disabled={isActionLoading}
                        >
                          {isActionLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          Start
                        </Button>
                      )}
                      {canStop && (
                        <Button
                          variant="black-outline"
                          size="sm"
                          onClick={() => handleStop(machine.id)}
                          disabled={isActionLoading}
                        >
                          {isActionLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                          Stop
                        </Button>
                      )}
                      <Button
                        variant="black-outline"
                        size="sm"
                        onClick={() => handleDelete(machine.id, machine.name)}
                        disabled={isDeleteLoading}
                        className="hover:bg-red-600 hover:text-white hover:border-red-600"
                      >
                        {isDeleteLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Launch VM Dialog */}
      <LaunchVmDialog
        open={launchVmOpen}
        onOpenChange={setLaunchVmOpen}
        userCredits={userCredits}
        onCreditsChange={() => {
          fetchUserCredits();
          fetchMachines();
        }}
      />

      {/* Fullscreen Modal */}
      {fullscreenMachine && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-gray-800">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                <h3 className="font-mono font-bold text-sm uppercase">
                  {fullscreenMachine.name}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
                <Radio className="w-3 h-3" />
                <span>INTERACTIVE</span>
              </div>
              <button
                onClick={() => setFullscreenMachine(null)}
                className="p-2 hover:bg-gray-800 rounded transition-colors"
                title="Exit fullscreen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          {/* VNC viewer */}
          <div className="flex-1">
            {getVncUrl(fullscreenMachine) && (
              <iframe
                src={getVncUrl(fullscreenMachine)!}
                className="w-full h-full border-0"
                allow="clipboard-read; clipboard-write"
              />
            )}
          </div>
        </div>
      )}
      </div>
    </DashboardLayout>
  );
}
