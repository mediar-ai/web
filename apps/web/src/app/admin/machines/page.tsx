'use client';

import { useState, useCallback, useMemo } from 'react';
import { Server, Plus, Activity, Eye, EyeOff, Zap, Clock, AlertTriangle, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { MachineCard } from '@/components/admin/MachineCard';
import { ProvisionVmDialog } from '@/components/admin/ProvisionVmDialog';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';

interface Machine {
  id: number;
  name: string;
  status: string;
  health_status: string;
  power_state?: string;
  mcp_endpoint?: string;
  azure_resource_id?: string;
  terraform_key?: string;
  last_health_check?: string;
  mcp_version?: string;
  tags?: string[];
  // Reliability metrics
  total_checks?: number;
  successful_checks?: number;
  uptime_percentage?: number;
  // Owner info
  owner_user_id?: string;
  owner_org_id?: string;
  owner_name?: string;
  // Activity
  last_execution_at?: string;
  created_at?: string;
  updated_at?: string;
}

// Trial VM lifecycle constants
const TRIAL_AUTO_STOP_MINUTES = 30;
const TRIAL_AUTO_DELETE_HOURS = 24;
const AUTO_STOP_CRON_INTERVAL_MINUTES = 5;
const AUTO_DELETE_CRON_INTERVAL_MINUTES = 60;

const REFRESH_INTERVAL = 15000; // 15 seconds for machine health

export default function AdminMachinesPage() {
  const [showInactive, setShowInactive] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [newMachine, setNewMachine] = useState({
    name: '',
    mcp_endpoint: '',
    management_endpoint: '',
    azure_resource_id: '',
    terraform_key: '',
  });
  const [adding, setAdding] = useState(false);
  const [showProvisionDialog, setShowProvisionDialog] = useState(false);

  const fetchMachines = useCallback(async (): Promise<Machine[]> => {
    console.log('[machines-page] Fetching machines...');
    const res = await fetch('/api/machines?status=all&show_all=true&include_load=true');
    if (!res.ok) {
      throw new Error('Failed to fetch machines');
    }
    const data = await res.json();
    // Sort: healthy+active first, then by recent health check
    const sorted = (data.machines || []).sort((a: Machine, b: Machine) => {
      // Primary: health status
      const healthOrder: Record<string, number> = {
        healthy: 0,
        unhealthy: 1,
        unknown: 2,
      };
      const healthDiff = (healthOrder[a.health_status] ?? 2) - (healthOrder[b.health_status] ?? 2);
      if (healthDiff !== 0) return healthDiff;

      // Secondary: status (active > inactive > maintenance)
      const statusOrder: Record<string, number> = {
        active: 0,
        inactive: 1,
        maintenance: 2,
      };
      const statusDiff = (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1);
      if (statusDiff !== 0) return statusDiff;

      // Tertiary: last health check (most recent first)
      const aTime = a.last_health_check ? new Date(a.last_health_check).getTime() : 0;
      const bTime = b.last_health_check ? new Date(b.last_health_check).getTime() : 0;
      return bTime - aTime;
    });
    return sorted;
  }, []);

  const {
    data: machines,
    loading,
    isRefreshing,
    autoRefreshEnabled,
    toggleAutoRefresh,
    refresh,
    lastUpdatedAgo,
    error,
  } = useAutoRefresh(fetchMachines, {
    interval: REFRESH_INTERVAL,
    storageKey: 'admin-machines-auto-refresh',
  });

  // Show error toast when fetch fails
  if (error) {
    toast.error(error);
  }

  const addMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachine.name || !newMachine.mcp_endpoint) {
      toast.error('Name and MCP endpoint are required');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMachine.name,
          mcp_endpoint: newMachine.mcp_endpoint,
          management_endpoint: newMachine.management_endpoint || newMachine.mcp_endpoint,
          azure_resource_id: newMachine.azure_resource_id || undefined,
          tags: newMachine.terraform_key ? [`terraform:${newMachine.terraform_key}`] : [],
        }),
      });

      if (res.ok) {
        toast.success('Machine added');
        setShowAddMachine(false);
        setNewMachine({
          name: '',
          mcp_endpoint: '',
          management_endpoint: '',
          azure_resource_id: '',
          terraform_key: '',
        });
        refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to add machine');
      }
    } catch {
      toast.error('Failed to add machine');
    } finally {
      setAdding(false);
    }
  };

  const machineList = machines || [];
  const healthyCount = machineList.filter(m => m.health_status === 'healthy').length;
  const activeCount = machineList.filter(m => m.status === 'active').length;
  const inactiveCount = machineList.filter(m => m.status !== 'active').length;

  // Trial VM lifecycle info
  const trialVmInfo = useMemo(() => {
    const trialVms = machineList.filter(m => m.tags?.includes('trial:true'));
    const now = Date.now();

    // VMs that will be auto-stopped (idle for > 30min)
    const idleThresholdMs = TRIAL_AUTO_STOP_MINUTES * 60 * 1000;
    const idleTrialVms = trialVms.filter(m => {
      if (m.status !== 'active') return false;
      if (!m.updated_at) return false;
      const lastActivity = new Date(m.updated_at).getTime();
      return (now - lastActivity) > idleThresholdMs;
    });

    // VMs approaching auto-stop (idle 20-30 min)
    const approachingIdleVms = trialVms.filter(m => {
      if (m.status !== 'active') return false;
      if (!m.updated_at) return false;
      const lastActivity = new Date(m.updated_at).getTime();
      const idleTime = now - lastActivity;
      return idleTime > (20 * 60 * 1000) && idleTime <= idleThresholdMs;
    });

    // VMs approaching deletion (> 20h old)
    const deleteThresholdMs = TRIAL_AUTO_DELETE_HOURS * 60 * 60 * 1000;
    const approachingDeleteVms = trialVms.filter(m => {
      if (!m.created_at) return false;
      const age = now - new Date(m.created_at).getTime();
      return age > (20 * 60 * 60 * 1000) && age <= deleteThresholdMs;
    });

    // VMs that should already be deleted (> 24h old)
    const expiredVms = trialVms.filter(m => {
      if (!m.created_at || m.status === 'deleted') return false;
      const age = now - new Date(m.created_at).getTime();
      return age > deleteThresholdMs;
    });

    // Calculate next cron times (approximate)
    const nowMinutes = new Date().getMinutes();
    const nextAutoStopMinutes = AUTO_STOP_CRON_INTERVAL_MINUTES - (nowMinutes % AUTO_STOP_CRON_INTERVAL_MINUTES);
    const nextAutoDeleteMinutes = AUTO_DELETE_CRON_INTERVAL_MINUTES - (nowMinutes % AUTO_DELETE_CRON_INTERVAL_MINUTES);

    return {
      total: trialVms.length,
      active: trialVms.filter(m => m.status === 'active').length,
      idle: idleTrialVms.length,
      approachingIdle: approachingIdleVms.length,
      approachingDelete: approachingDeleteVms.length,
      expired: expiredVms.length,
      idleVms: idleTrialVms,
      approachingIdleVms,
      approachingDeleteVms,
      expiredVms,
      nextAutoStopMinutes,
      nextAutoDeleteMinutes,
    };
  }, [machineList]);

  // Filter machines based on showInactive toggle
  const displayedMachines = showInactive
    ? machineList
    : machineList.filter(m => m.status === 'active' || m.health_status === 'healthy');

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Server className="w-6 h-6" />
            MACHINES
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            VM infrastructure management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2 border-2 border-black font-mono text-sm">
            <Activity className="w-4 h-4" />
            {healthyCount}/{activeCount} healthy
          </div>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className={`p-2 border-2 border-black transition-colors ${
              showInactive ? 'bg-black text-white' : 'hover:bg-black hover:text-white'
            }`}
            title={showInactive ? 'Hide inactive' : 'Show inactive'}
          >
            {showInactive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowProvisionDialog(true)}
            className="flex items-center gap-2 px-3 py-2 border-2 border-black bg-black text-white font-mono text-sm hover:bg-white hover:text-black transition-colors"
            title="Provision new Azure VM"
          >
            <Zap className="w-4 h-4" />
            PROVISION
          </button>
          <button
            onClick={() => setShowAddMachine(!showAddMachine)}
            className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
            title="Register existing machine"
          >
            <Plus className="w-4 h-4" />
          </button>
          <AutoRefreshControls
            loading={loading}
            isRefreshing={isRefreshing}
            autoRefreshEnabled={autoRefreshEnabled}
            lastUpdatedAgo={lastUpdatedAgo}
            intervalSeconds={REFRESH_INTERVAL / 1000}
            onRefresh={refresh}
            onToggleAutoRefresh={toggleAutoRefresh}
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Total</div>
          <div className="font-mono font-bold text-xl">{machineList.length}</div>
        </div>
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Active</div>
          <div className="font-mono font-bold text-xl">{activeCount}</div>
        </div>
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Healthy</div>
          <div className="font-mono font-bold text-xl">{healthyCount}</div>
        </div>
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Inactive</div>
          <div className="font-mono font-bold text-xl">{inactiveCount}</div>
        </div>
      </div>

      {/* Trial VM Lifecycle Info */}
      {trialVmInfo.total > 0 && (
        <div className="mb-6 border-2 border-black p-4 bg-gray-50">
          <div className="flex items-center gap-2 mb-3">
            <Timer className="w-4 h-4" />
            <h2 className="font-mono font-bold text-sm uppercase">Trial Sandbox Lifecycle</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center p-2 border border-gray-300 rounded">
              <div className="font-mono text-xs text-gray-500 uppercase">Trial VMs</div>
              <div className="font-mono font-bold text-lg">{trialVmInfo.total}</div>
              <div className="font-mono text-xs text-gray-500">{trialVmInfo.active} active</div>
            </div>
            <div className={`text-center p-2 border rounded ${trialVmInfo.idle > 0 ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}>
              <div className="font-mono text-xs text-gray-500 uppercase">Will Stop</div>
              <div className="font-mono font-bold text-lg">{trialVmInfo.idle}</div>
              <div className="font-mono text-xs text-gray-500">idle &gt;30min</div>
            </div>
            <div className={`text-center p-2 border rounded ${trialVmInfo.approachingIdle > 0 ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'}`}>
              <div className="font-mono text-xs text-gray-500 uppercase">Near Idle</div>
              <div className="font-mono font-bold text-lg">{trialVmInfo.approachingIdle}</div>
              <div className="font-mono text-xs text-gray-500">20-30min idle</div>
            </div>
            <div className={`text-center p-2 border rounded ${trialVmInfo.approachingDelete > 0 ? 'border-orange-400 bg-orange-50' : 'border-gray-300'}`}>
              <div className="font-mono text-xs text-gray-500 uppercase">Near Delete</div>
              <div className="font-mono font-bold text-lg">{trialVmInfo.approachingDelete}</div>
              <div className="font-mono text-xs text-gray-500">&gt;20h old</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs font-mono text-gray-600">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Auto-stop check: ~{trialVmInfo.nextAutoStopMinutes}min</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Auto-delete check: ~{trialVmInfo.nextAutoDeleteMinutes}min</span>
            </div>
            <div className="text-gray-400">|</div>
            <span>Stop: {TRIAL_AUTO_STOP_MINUTES}min idle</span>
            <span>Delete: {TRIAL_AUTO_DELETE_HOURS}h old</span>
          </div>

          {/* List VMs that will be affected */}
          {(trialVmInfo.idle > 0 || trialVmInfo.expired > 0) && (
            <div className="mt-3 pt-3 border-t border-gray-300">
              {trialVmInfo.idleVms.length > 0 && (
                <div className="flex items-start gap-2 text-xs font-mono mb-1">
                  <AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>Will stop next check:</strong>{' '}
                    {trialVmInfo.idleVms.map(m => m.name).join(', ')}
                  </span>
                </div>
              )}
              {trialVmInfo.expiredVms.length > 0 && (
                <div className="flex items-start gap-2 text-xs font-mono">
                  <AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                  <span>
                    <strong>Will delete next check:</strong>{' '}
                    {trialVmInfo.expiredVms.map(m => m.name).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add Machine Form */}
      {showAddMachine && (
        <form onSubmit={addMachine} className="mb-6 border-2 border-black p-4 bg-gray-50">
          <h2 className="font-mono font-bold mb-4">ADD NEW MACHINE</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                Name *
              </label>
              <input
                type="text"
                value={newMachine.name}
                onChange={e => setNewMachine({ ...newMachine, name: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="e.g., VM3 - Customer Name"
                required
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                MCP Endpoint *
              </label>
              <input
                type="text"
                value={newMachine.mcp_endpoint}
                onChange={e => setNewMachine({ ...newMachine, mcp_endpoint: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="http://IP:8080/mcp"
                required
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                Azure Resource ID
              </label>
              <input
                type="text"
                value={newMachine.azure_resource_id}
                onChange={e => setNewMachine({ ...newMachine, azure_resource_id: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="/subscriptions/..."
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-gray-600 uppercase mb-1">
                Terraform Key (for VNC)
              </label>
              <input
                type="text"
                value={newMachine.terraform_key}
                onChange={e => setNewMachine({ ...newMachine, terraform_key: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="e.g., vm3"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              disabled={adding}
              className="px-4 py-2 border-2 border-black bg-black text-white font-mono text-sm hover:bg-white hover:text-black transition-colors disabled:opacity-50"
            >
              {adding ? 'ADDING...' : 'ADD MACHINE'}
            </button>
            <button
              type="button"
              onClick={() => setShowAddMachine(false)}
              className="px-4 py-2 border-2 border-black font-mono text-sm hover:bg-gray-100 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </form>
      )}

      {/* Machine List */}
      {loading && !machines ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      ) : machineList.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-400">
          <Server className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="font-mono text-gray-600">No machines registered</p>
          <button
            onClick={() => setShowAddMachine(true)}
            className="mt-4 px-4 py-2 border-2 border-black font-mono text-sm hover:bg-black hover:text-white transition-colors"
          >
            ADD FIRST MACHINE
          </button>
        </div>
      ) : (
        <>
          {!showInactive && inactiveCount > 0 && (
            <div className="mb-4 text-sm font-mono text-gray-500">
              Showing {displayedMachines.length} active/healthy machines.{' '}
              <button
                onClick={() => setShowInactive(true)}
                className="underline hover:text-black"
              >
                Show {inactiveCount} inactive
              </button>
            </div>
          )}
          <div className="space-y-3">
            {displayedMachines.map(machine => (
              <MachineCard
                key={machine.id}
                machine={machine}
                onRefresh={refresh}
                compact={machine.status !== 'active' && machine.health_status !== 'healthy'}
              />
            ))}
          </div>
        </>
      )}

      {/* Provision VM Dialog */}
      <ProvisionVmDialog
        isOpen={showProvisionDialog}
        onClose={() => setShowProvisionDialog(false)}
        onSuccess={refresh}
      />
    </div>
  );
}
