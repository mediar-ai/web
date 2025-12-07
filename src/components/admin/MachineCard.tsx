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
  FileText,
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
}

type OperationType = 'start' | 'stop' | 'restart' | 'deallocate';

export function MachineCard({ machine, onRefresh }: MachineCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadingOperation, setLoadingOperation] = useState<OperationType | null>(null);
  const [showVnc, setShowVnc] = useState(false);

  const powerState = machine.power_state || 'unknown';
  const isRunning = powerState === 'running';
  const isStopped = powerState === 'stopped' || powerState === 'deallocated';
  const isTransitioning = ['starting', 'stopping', 'deallocating'].includes(powerState);

  const getPowerIndicator = () => {
    if (isRunning) return { color: 'bg-black', animation: '' };
    if (isStopped) return { color: 'bg-gray-400', animation: '' };
    if (isTransitioning) return { color: 'bg-gray-600', animation: 'animate-pulse' };
    return { color: 'bg-gray-300', animation: '' };
  };

  const getHealthBadge = () => {
    const status = machine.health_status;
    if (status === 'healthy') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono border-2 border-black bg-white">
          <span className="w-2 h-2 rounded-full bg-black" />
          HEALTHY
        </span>
      );
    }
    if (status === 'unhealthy' || status === 'unreachable') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono border-2 border-black bg-black text-white font-bold">
          <span className="w-2 h-2 rounded-full bg-white" />
          {status.toUpperCase()}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono border-2 border-dashed border-gray-400 bg-gray-100">
        <span className="w-2 h-2 rounded-full bg-gray-400" />
        UNKNOWN
      </span>
    );
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
    } catch (error) {
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
  const indicator = getPowerIndicator();

  return (
    <div className="border-2 border-black bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b-2 border-black bg-black text-white">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${indicator.color} ${indicator.animation}`} />
          <span className="font-mono font-bold">{machine.name}</span>
          <span className="text-xs font-mono text-gray-400 uppercase">{powerState}</span>
        </div>
        {getHealthBadge()}
      </div>

      {/* Quick Info */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-b border-gray-200">
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
          <div className="text-xs text-gray-500 font-mono uppercase">MCP Version</div>
          <div className="font-mono">{machine.mcp_version || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 font-mono uppercase">Status</div>
          <div className="font-mono uppercase">{machine.status}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 flex flex-wrap gap-2">
        {/* Power controls */}
        <button
          onClick={() => executeOperation('start')}
          disabled={isRunning || loadingOperation !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loadingOperation === 'start' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          START
        </button>

        <button
          onClick={() => executeOperation('stop')}
          disabled={isStopped || loadingOperation !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loadingOperation === 'stop' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Square className="w-4 h-4" />
          )}
          STOP
        </button>

        <button
          onClick={() => executeOperation('restart')}
          disabled={isStopped || loadingOperation !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loadingOperation === 'restart' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RotateCcw className="w-4 h-4" />
          )}
          RESTART
        </button>

        <button
          onClick={() => executeOperation('deallocate')}
          disabled={powerState === 'deallocated' || loadingOperation !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-red-600 hover:text-white hover:border-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loadingOperation === 'deallocate' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Power className="w-4 h-4" />
          )}
          DEALLOCATE
        </button>

        <div className="border-l border-gray-300 mx-1" />

        {/* VNC */}
        {vncUrl && (
          <>
            <button
              onClick={() => setShowVnc(!showVnc)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white transition-colors"
            >
              <Monitor className="w-4 h-4" />
              VNC
            </button>
            <a
              href={vncUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </>
        )}

        {/* Expand for more */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white transition-colors ml-auto"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4" />
              LESS
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              MORE
            </>
          )}
        </button>
      </div>

      {/* VNC Viewer */}
      {showVnc && vncUrl && (
        <div className="border-t-2 border-black">
          <div className="p-2 bg-gray-50 flex items-center justify-between border-b border-gray-200">
            <span className="text-xs font-mono text-gray-600">VNC - READ-ONLY</span>
            <button
              onClick={() => setShowVnc(false)}
              className="text-xs font-mono hover:underline"
            >
              CLOSE
            </button>
          </div>
          <iframe
            src={vncUrl}
            className="w-full h-96 bg-black"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t-2 border-black p-4 bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500 font-mono uppercase mb-1">Azure Resource ID</div>
              <div className="font-mono text-xs break-all flex items-start gap-1">
                {machine.azure_resource_id || '-'}
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
              <div className="md:col-span-2">
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

          {/* Quick Links */}
          <div className="mt-4 flex gap-2">
            <a
              href={`/observability?service=mcp-vm-agent`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono border-2 border-black bg-white hover:bg-black hover:text-white transition-colors"
            >
              <FileText className="w-4 h-4" />
              VIEW LOGS
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
