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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LaunchVmDialog } from '@/components/vm/LaunchVmDialog';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';

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
}

export default function MyMachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [launchVmOpen, setLaunchVmOpen] = useState(false);
  const [userCredits, setUserCredits] = useState(0);

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

  useEffect(() => {
    fetchMachines();
    fetchUserCredits();

    // Poll for updates every 30 seconds
    const interval = setInterval(fetchMachines, 30000);
    return () => clearInterval(interval);
  }, [fetchMachines, fetchUserCredits]);

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
    const isProvisioning = status === 'inactive' && machine.provisioning_step;

    if (isProvisioning) {
      const step = typeof machine.provisioning_step === 'string'
        ? JSON.parse(machine.provisioning_step)
        : machine.provisioning_step;
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
        return {
          label: 'Stopping...',
          color: 'text-gray-600',
          bg: 'bg-gray-100',
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
        };
      case 'stopped':
      case 'inactive':
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
          <div className="space-y-4">
            {machines.map(machine => {
              const statusDisplay = getStatusDisplay(machine);
              const isActive = machine.status === 'active';
              const canStart = ['stopped', 'inactive'].includes(machine.status) && !machine.provisioning_step;
              const canStop = machine.status === 'active';
              const isActionLoading = actionLoading === machine.id;

              return (
                <div
                  key={machine.id}
                  className="border-2 border-black p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        'p-3 rounded-lg',
                        isActive ? 'bg-black text-white' : 'bg-gray-100'
                      )}>
                        <Monitor className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-mono font-bold text-lg">{machine.name}</h3>
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {machine.region}
                          </span>
                          <span>Created {formatDate(machine.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Status Badge */}
                      <div className={cn(
                        'px-3 py-1 rounded-full flex items-center gap-2 text-sm font-mono',
                        statusDisplay.bg
                      )}>
                        {statusDisplay.icon}
                        {statusDisplay.label}
                      </div>

                      {/* Actions */}
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
                          disabled={isActionLoading}
                          className="hover:bg-red-600 hover:text-white hover:border-red-600"
                        >
                          {isActionLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          Delete
                        </Button>
                      </div>
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
      </div>
    </DashboardLayout>
  );
}
