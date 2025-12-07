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
    azure_resource_id?: string;
    terraform_key?: string;
    last_health_check?: string;
    mcp_version?: string;
    tags?: string[];
  };
  onRefresh: () => void;
  compact?: boolean;
}

type OperationType = 'start' | 'stop' | 'restart' | 'deallocate';

export function MachineCard({ machine, onRefresh, compact = false }: MachineCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadingOperation, setLoadingOperation] = useState<OperationType | null>(null);
  const [showVnc, setShowVnc] = useState(false);

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

  const getVncUrl = () => {
    const key = machine.terraform_key || machine.tags?.find(t => t.startsWith('terraform:'))?.replace('terraform:', '');
    if (!key) return null;
    return `${VNC_GATEWAY_URL}/vnc/${key}`;
  };

  const vncUrl = getVncUrl();
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
            {extractIpFromEndpoint(machine.mcp_endpoint)}
            {machine.mcp_endpoint && (
              <button
                onClick={() => copyToClipboard(extractIpFromEndpoint(machine.mcp_endpoint), 'IP')}
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
          <div className="font-mono text-xs">{machine.mcp_version || '-'}</div>
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

        {/* VNC */}
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
            {machine.mcp_endpoint && (
              <button
                onClick={() => {
                  const ip = extractIpFromEndpoint(machine.mcp_endpoint);
                  if (ip && ip !== '-') {
                    copyToClipboard(`${ip}:5900`, 'VNC address');
                  }
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono border border-black bg-white hover:bg-black hover:text-white transition-colors"
                title="Copy VNC address for TightVNC/TigerVNC"
              >
                <Copy className="w-3 h-3" />
                VNC
              </button>
            )}
          </>
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
