'use client';

import { useEffect, useState, useCallback } from 'react';
import { Server, RefreshCw, Plus, Activity, Eye, EyeOff, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { MachineCard } from '@/components/admin/MachineCard';
import { ProvisionVmDialog } from '@/components/admin/ProvisionVmDialog';

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
}

export default function AdminMachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
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

  const fetchMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/machines?status=all&show_all=true&include_load=true');
      if (res.ok) {
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
        setMachines(sorted);
      }
    } catch (error) {
      console.error('Failed to fetch machines:', error);
      toast.error('Failed to load machines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMachines();
  }, [fetchMachines]);

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
        fetchMachines();
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

  const healthyCount = machines.filter(m => m.health_status === 'healthy').length;
  const activeCount = machines.filter(m => m.status === 'active').length;
  const inactiveCount = machines.filter(m => m.status !== 'active').length;

  // Filter machines based on showInactive toggle
  const displayedMachines = showInactive
    ? machines
    : machines.filter(m => m.status === 'active' || m.health_status === 'healthy');

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
          <button
            onClick={() => {
              setLoading(true);
              fetchMachines();
            }}
            className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Total</div>
          <div className="font-mono font-bold text-xl">{machines.length}</div>
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
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      ) : machines.length === 0 ? (
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
                onRefresh={fetchMachines}
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
        onSuccess={fetchMachines}
      />
    </div>
  );
}
