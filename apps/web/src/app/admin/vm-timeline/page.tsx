'use client';

import { useEffect, useState } from 'react';
import {
  Clock,
  RefreshCw,
  Server,
  Play,
  Square,
  RotateCcw,
  Power,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface Operation {
  id: number;
  machine_id: number;
  machine_name: string;
  operation_type: string;
  operation_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  initiated_by: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  details: Record<string, unknown> | null;
}

export default function AdminVMTimelinePage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'running' | 'failed'>('all');

  useEffect(() => {
    fetchOperations();
  }, []);

  const fetchOperations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/vm-timeline?limit=100');
      if (res.ok) {
        const data = await res.json();
        setOperations(data.operations || []);
      } else {
        // Placeholder if API doesn't exist yet
        setOperations([]);
      }
    } catch (error) {
      console.error('Failed to fetch operations:', error);
      toast.error('Failed to load VM timeline');
    } finally {
      setLoading(false);
    }
  };

  const getOperationIcon = (type: string) => {
    switch (type) {
      case 'start':
        return <Play className="w-4 h-4" />;
      case 'stop':
        return <Square className="w-4 h-4" />;
      case 'restart':
        return <RotateCcw className="w-4 h-4" />;
      case 'deallocate':
        return <Power className="w-4 h-4" />;
      default:
        return <Server className="w-4 h-4" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4" />;
      case 'running':
        return <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-white text-black border-2 border-black';
      case 'failed':
        return 'bg-black text-white';
      case 'running':
        return 'bg-gray-100 text-black border-2 border-dashed border-gray-400';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const filteredOperations = operations.filter(op => {
    if (filter === 'all') return true;
    if (filter === 'running') return op.status === 'running' || op.status === 'pending';
    if (filter === 'failed') return op.status === 'failed';
    return true;
  });

  const runningCount = operations.filter(
    op => op.status === 'running' || op.status === 'pending'
  ).length;
  const failedCount = operations.filter(op => op.status === 'failed').length;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Clock className="w-6 h-6" />
            VM TIMELINE
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            VM operations history and audit log
          </p>
        </div>
        <button
          onClick={fetchOperations}
          className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="border-2 border-black p-4">
              <div className="font-mono text-xs text-gray-600 uppercase mb-1">Total Operations</div>
              <div className="font-mono font-bold text-2xl">{operations.length}</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="font-mono text-xs text-gray-600 uppercase mb-1">Running</div>
              <div className="font-mono font-bold text-2xl">{runningCount}</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="font-mono text-xs text-gray-600 uppercase mb-1">Failed</div>
              <div className="font-mono font-bold text-2xl">{failedCount}</div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex border-2 border-black mb-4">
            {(['all', 'running', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 px-4 py-2 font-mono text-sm ${
                  filter === f ? 'bg-black text-white' : 'bg-white hover:bg-gray-100'
                } ${f !== 'all' ? 'border-l-2 border-black' : ''}`}
              >
                {f.toUpperCase()}
                {f === 'running' && runningCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-white text-black text-xs">
                    {runningCount}
                  </span>
                )}
                {f === 'failed' && failedCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-white text-black text-xs">
                    {failedCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Timeline */}
          <div className="border-2 border-black">
            <div className="p-3 border-b-2 border-black bg-black text-white">
              <span className="font-mono font-bold text-sm">OPERATION HISTORY</span>
            </div>
            {filteredOperations.length === 0 ? (
              <div className="p-8 text-center font-mono text-gray-600">
                <Clock className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p>No operations recorded</p>
                <p className="text-sm text-gray-500 mt-2">
                  VM operations will appear here as they occur
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredOperations.map(op => (
                  <div key={op.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-gray-100 border border-black">
                          {getOperationIcon(op.operation_type)}
                        </div>
                        <div>
                          <div className="font-mono font-bold flex items-center gap-2">
                            {op.operation_type.toUpperCase()}
                            <span className={`px-2 py-0.5 text-xs ${getStatusStyles(op.status)}`}>
                              <span className="flex items-center gap-1">
                                {getStatusIcon(op.status)}
                                {op.status.toUpperCase()}
                              </span>
                            </span>
                          </div>
                          <div className="font-mono text-sm text-gray-600 mt-1">
                            <Server className="w-3 h-3 inline mr-1" />
                            {op.machine_name || `Machine #${op.machine_id}`}
                          </div>
                          {op.error_message && (
                            <div className="font-mono text-sm text-gray-800 mt-2 p-2 bg-gray-100 border border-gray-300">
                              {op.error_message}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs text-gray-500">
                          {new Date(op.started_at).toLocaleString()}
                        </div>
                        {op.completed_at && (
                          <div className="font-mono text-xs text-gray-400 mt-1">
                            Duration:{' '}
                            {Math.round(
                              (new Date(op.completed_at).getTime() -
                                new Date(op.started_at).getTime()) /
                                1000
                            )}
                            s
                          </div>
                        )}
                        <div className="font-mono text-xs text-gray-400 mt-1">
                          By: {op.initiated_by || 'System'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
