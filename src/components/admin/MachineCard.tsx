'use client';

import { useState } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Power,
  Monitor,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { VNC_GATEWAY_URL } from '@/lib/azure';

interface MachineCardProps {
  machine: {
    id: number;
    name: string;
    status: string;
    health_status: string;
    power_state?: string;
    mcp_endpoint?: string;
    health_endpoint?: string;
    management_endpoint?: string;
    azure_resource_id?: string;
    terraform_key?: string;
    last_health_check?: string;
    mcp_version?: string;
    tags?: string[];
    // Reliability metrics
    total_checks?: number;
    successful_checks?: number;
    uptime_percentage?: number;
    // Boot time metrics
    provisioned_at?: string;
    first_healthy_at?: string;
  };
  onRefresh: () => void;
  compact?: boolean;
}

type OperationType = 'start' | 'stop' | 'restart' | 'deallocate';

export function MachineCard({ machine, onRefresh, compact = false }: MachineCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadingOperation, setLoadingOperation] = useState<OperationType | null>(null);
  const [showVnc, setShowVnc] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const powerState = machine.power_state || 'unknown';
  const isRunning = powerState === 'running';
  const isStopped = powerState === 'stopped' || powerState === 'deallocated';
  const isTransitioning = ['starting', 'stopping', 'deallocating'].includes(powerState);

  const getHealthIndicator = () => {
    const status = machine.health_status;
    if (status === 'healthy') {
      return { bg: 'bg-black', ring: '', text: 'HEALTHY' };
    }
    if (status === 'unhealthy' || status === 'unreachable') {
      return { bg: 'bg-black', ring: 'ring-2 ring-black ring-offset-2', text: status.toUpperCase() };
    }
    return { bg: 'bg-gray-400', ring: '', text: 'UNKNOWN' };
  };

  const formatTimeAgo = (timestamp: string | undefined) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  };

  const extractIpFromEndpoint = (endpoint: string | undefined) => {
    if (!endpoint) return '-';
    try {
      const url = new URL(endpoint);
      return url.hostname;
    } catch {
      return '-';
    }
  };

  // Get the best available IP from any endpoint
  const getBestIp = () => {
    let ip = extractIpFromEndpoint(machine.mcp_endpoint);
    if (ip === '-') ip = extractIpFromEndpoint(machine.health_endpoint);
    if (ip === '-') ip = extractIpFromEndpoint(machine.management_endpoint);
    return ip;
  };

  const getBootTime = () => {
    if (!machine.provisioned_at || !machine.first_healthy_at) return null;
    const provisioned = new Date(machine.provisioned_at).getTime();
    const firstHealthy = new Date(machine.first_healthy_at).getTime();
    const bootTimeSeconds = Math.round((firstHealthy - provisioned) / 1000);
    const minutes = Math.floor(bootTimeSeconds / 60);
    const seconds = bootTimeSeconds % 60;
    return { seconds: bootTimeSeconds, formatted: `${minutes}m ${seconds}s` };
  };

  const bootTime = getBootTime();

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const executeOperation = async (operation: OperationType) => {
    if (!machine.azure_resource_id) {
      toast.error('No Azure resource ID configured for this machine');
      return;
    }

    setLoadingOperation(operation);
    try {
      const endpoint = operation === 'restart'
        ? `/api/admin/machines/${machine.id}/restart`
        : `/api/machines/${machine.id}/${operation}`;

      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json();

      if (response.ok) {
        toast.success(data.message || `${operation} initiated`);
        onRefresh();
      } else {
        toast.error(data.error || `${operation} failed`);
      }
    } catch {
      toast.error(`Failed to ${operation} machine`);
    } finally {
      setLoadingOperation(null);
    }
  };

  const handleDelete = async () => {
    // Double confirm for destructive action
    const confirmed = confirm(
      `Are you sure you want to DELETE "${machine.name}"?\n\n` +
      `This will:\n` +
      `- Delete the Azure VM and ALL associated resources (disk, NIC, IP, NSG, VNet)\n` +
      `- Remove the machine from the database\n\n` +
      `This action CANNOT be undone.`
    );

    if (!confirmed) return;

    // Second confirmation with machine name
    const confirmName = prompt(
      `To confirm deletion, type the machine name: ${machine.name}`
    );

    if (confirmName !== machine.name) {
      toast.error('Machine name did not match. Deletion cancelled.');
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/admin/machines/${machine.id}/delete`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (response.ok) {
        toast.success(data.message || 'Machine deleted successfully');
        onRefresh();
      } else {
        toast.error(data.error || 'Delete failed');
      }
    } catch {
      toast.error('Failed to delete machine');
    } finally {
      setIsDeleting(false);
    }
  };

  const getVncUrl = () => {
    // For VNC gateway, only use terraform keys that the gateway knows about (e.g., vm1, vm2, etc.)
    // Auto-provisioned VMs (dashboard-*) aren't registered with the gateway
    const key = machine.terraform_key || machine.tags?.find(t => t.startsWith('terraform:'))?.replace('terraform:', '');
    if (!key) return null;
    // Skip gateway for dashboard-provisioned VMs
    if (key.startsWith('dashboard-')) return null;
    return `${VNC_GATEWAY_URL}/vnc/${key}`;
  };

  // Get direct VNC address (IP:5900) for any VM with an endpoint
  // Try mcp_endpoint first, then health_endpoint, then management_endpoint
  const getDirectVncAddress = () => {
    let ip = extractIpFromEndpoint(machine.mcp_endpoint);
    if (!ip || ip === '-') {
      ip = extractIpFromEndpoint(machine.health_endpoint);
    }
    if (!ip || ip === '-') {
      ip = extractIpFromEndpoint(machine.management_endpoint);
    }
    if (!ip || ip === '-') return null;
    return `${ip}:5900`;
  };

  const vncUrl = getVncUrl();
  const directVncAddress = getDirectVncAddress();
  const indicator = getHealthIndicator();
  const hasAzure = !!machine.azure_resource_id;

  // Compact view for inactive machines
  if (compact) {
    return (
      <div className="border border-gray-300 bg-gray-50 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${indicator.bg}`} />
          <span className="font-mono text-sm text-gray-600">{machine.name}</span>
          <span className="text-xs font-mono text-gray-400 uppercase">{machine.status}</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <span>{formatTimeAgo(machine.last_health_check)}</span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2 py-1 border border-gray-300 hover:bg-gray-200 transition-colors"
          >
            {isExpanded ? 'LESS' : 'MORE'}
          </button>
        </div>
        {isExpanded && (
          <div className="absolute right-0 top-full mt-1 z-10 bg-white border-2 border-black p-4 shadow-lg">
            <div className="text-sm space-y-2">
              <div><span className="text-gray-500">ID:</span> {machine.id}</div>
              <div><span className="text-gray-500">Endpoint:</span> {machine.mcp_endpoint || '-'}</div>
              <div><span className="text-gray-500">Azure:</span> {hasAzure ? 'Yes' : 'No'}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`border-2 ${machine.health_status === 'healthy' ? 'border-black' : 'border-gray-400'} bg-white`}>
      {/* Header */}
      <div className={`flex items-center justify-between p-3 ${machine.health_status === 'healthy' ? 'bg-black text-white' : 'bg-gray-100 text-black'}`}>
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${machine.health_status === 'healthy' ? 'bg-white' : indicator.bg} ${isTransitioning ? 'animate-pulse' : ''}`} />
          <span className="font-mono font-bold">{machine.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {machine.health_status === 'healthy' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-white text-black">
              HEALTHY
            </span>
          ) : machine.health_status === 'unhealthy' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-black text-white border border-black font-bold">
              <AlertCircle className="w-3 h-3" />
              UNHEALTHY
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-gray-200 text-gray-600 border border-dashed border-gray-400">
              UNKNOWN
            </span>
          )}
          <span className="text-xs font-mono opacity-70 uppercase">{machine.status}</span>
        </div>
      </div>

      {/* Quick Info */}
      <div className="p-3 grid grid-cols-4 gap-3 text-sm border-b border-gray-200">
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase">IP</div>
          <div className="font-mono flex items-center gap-1">
            {getBestIp()}
            {getBestIp() !== '-' && (
              <button
                onClick={() => copyToClipboard(getBestIp(), 'IP')}
                className="p-0.5 hover:bg-gray-100 rounded"
              >
                <Copy className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase">Last Check</div>
          <div className="font-mono">{formatTimeAgo(machine.last_health_check)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase">MCP</div>
          <div className="font-mono text-xs flex items-center gap-1">
            {machine.mcp_version ? (
              <span className="text-green-600">v{machine.mcp_version}</span>
            ) : machine.mcp_endpoint ? (
              <span className="text-gray-400" title={machine.mcp_endpoint}>Not responding</span>
            ) : (
              <span className="text-gray-400">No endpoint</span>
            )}
            {machine.mcp_endpoint && (
              <a
                href={machine.mcp_endpoint.replace('/mcp', '/health')}
                target="_blank"
                rel="noopener noreferrer"
                className="p-0.5 hover:bg-gray-100 rounded"
                title="Open health endpoint"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase">Azure</div>
          <div className="font-mono text-xs">{hasAzure ? 'Configured' : 'Not set'}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 flex flex-wrap gap-2">
        {/* Power controls - only if Azure is configured */}
        {hasAzure ? (
          <>
            <button
              onClick={() => executeOperation('start')}
              disabled={isRunning || loadingOperation !== null}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loadingOperation === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              START
            </button>

            <button
              onClick={() => executeOperation('stop')}
              disabled={isStopped || loadingOperation !== null}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loadingOperation === 'stop' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              STOP
            </button>

            <button
              onClick={() => executeOperation('restart')}
              disabled={isStopped || loadingOperation !== null}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loadingOperation === 'restart' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              RESTART
            </button>

            <button
              onClick={() => executeOperation('deallocate')}
              disabled={powerState === 'deallocated' || loadingOperation !== null}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-red-600 hover:text-white hover:border-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loadingOperation === 'deallocate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
              DEALLOCATE
            </button>
          </>
        ) : (
          <span className="text-xs font-mono text-gray-400">No Azure controls (no resource ID)</span>
        )}

        <div className="border-l border-gray-300 mx-1" />

        {/* VNC - Show if gateway URL or direct address available */}
        {(vncUrl || directVncAddress) && (
          <>
            {/* VNC via gateway (if available) */}
            {vncUrl && (
              <>
                <button
                  onClick={() => setShowVnc(!showVnc)}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black transition-colors ${showVnc ? 'bg-black text-white' : 'bg-white hover:bg-black hover:text-white'}`}
                >
                  <Monitor className="w-3 h-3" />
                  VNC
                </button>
                <a
                  href={vncUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white transition-colors"
                  title="Open in browser"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </>
            )}
            {/* Direct VNC address (always available if we have an IP) */}
            {directVncAddress && (
              <button
                onClick={() => copyToClipboard(directVncAddress, 'VNC address')}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white transition-colors"
                title={`Copy VNC address: ${directVncAddress} (use TightVNC/TigerVNC)`}
              >
                <Copy className="w-3 h-3" />
                {directVncAddress}
              </button>
            )}
          </>
        )}

        {/* Delete button - more visible */}
        {hasAzure && (
          <button
            onClick={handleDelete}
            disabled={isDeleting || loadingOperation !== null}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-red-600 text-red-600 hover:bg-red-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Delete VM and all Azure resources"
          >
            {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            DELETE
          </button>
        )}

        {/* Expand for more */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white transition-colors ml-auto"
        >
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {isExpanded ? 'LESS' : 'MORE'}
        </button>
      </div>

      {/* VNC Viewer */}
      {showVnc && vncUrl && (
        <div className="border-t-2 border-black">
          <div className="p-2 bg-gray-50 flex items-center justify-between border-b border-gray-200">
            <span className="text-xs font-mono text-gray-600">VNC VIEWER</span>
            <button onClick={() => setShowVnc(false)} className="text-xs font-mono hover:underline">
              CLOSE
            </button>
          </div>
          <iframe
            src={vncUrl}
            className="w-full h-80 bg-black"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-3 bg-gray-50">
          {/* Uptime Stats */}
          {(machine.total_checks ?? 0) > 0 && (
            <div className="mb-4 p-3 border border-gray-300 bg-white">
              <div className="text-xs text-gray-500 font-mono uppercase mb-2">HEALTH RELIABILITY</div>
              <div className="flex items-center gap-4">
                {/* Success rate bar */}
                <div className="flex-1">
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span>Success Rate</span>
                    <span className="font-bold">
                      {machine.total_checks && machine.total_checks > 0
                        ? `${Math.round((machine.successful_checks || 0) / machine.total_checks * 100)}%`
                        : '-'}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 w-full">
                    <div
                      className="h-full bg-black transition-all"
                      style={{
                        width: machine.total_checks && machine.total_checks > 0
                          ? `${Math.round((machine.successful_checks || 0) / machine.total_checks * 100)}%`
                          : '0%'
                      }}
                    />
                  </div>
                </div>
                {/* Stats */}
                <div className="text-right text-xs font-mono">
                  <div className="text-gray-500">{machine.successful_checks || 0} / {machine.total_checks || 0}</div>
                  <div className="text-gray-400">checks</div>
                </div>
              </div>
              {machine.uptime_percentage !== undefined && machine.uptime_percentage !== null && (
                <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between text-xs font-mono">
                  <span className="text-gray-500">Uptime</span>
                  <span className="font-bold">{machine.uptime_percentage.toFixed(1)}%</span>
                </div>
              )}
            </div>
          )}

          {/* Boot Time (for auto-provisioned VMs) */}
          {(bootTime || machine.provisioned_at) && (
            <div className="mb-4 p-3 border border-gray-300 bg-white">
              <div className="text-xs text-gray-500 font-mono uppercase mb-2">BOOT METRICS</div>
              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                {bootTime && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Boot Time</span>
                    <span className="font-bold">{bootTime.formatted}</span>
                  </div>
                )}
                {machine.provisioned_at && !machine.first_healthy_at && (
                  <div className="flex justify-between col-span-2">
                    <span className="text-gray-500">Provisioned</span>
                    <span className="text-gray-400">Waiting for first healthy check...</span>
                  </div>
                )}
                {machine.provisioned_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Provisioned At</span>
                    <span>{new Date(machine.provisioned_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500 font-mono uppercase mb-1">Azure Resource ID</div>
              <div className="font-mono text-xs break-all flex items-start gap-1">
                {machine.azure_resource_id || <span className="text-gray-400">Not configured</span>}
                {machine.azure_resource_id && (
                  <button
                    onClick={() => copyToClipboard(machine.azure_resource_id!, 'Resource ID')}
                    className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 font-mono uppercase mb-1">MCP Endpoint</div>
              <div className="font-mono text-xs break-all flex items-start gap-1">
                {machine.mcp_endpoint || '-'}
                {machine.mcp_endpoint && (
                  <button
                    onClick={() => copyToClipboard(machine.mcp_endpoint!, 'Endpoint')}
                    className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            {machine.tags && machine.tags.length > 0 && (
              <div className="col-span-2">
                <div className="text-xs text-gray-500 font-mono uppercase mb-1">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {machine.tags.map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs font-mono bg-gray-200 border border-gray-300">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
