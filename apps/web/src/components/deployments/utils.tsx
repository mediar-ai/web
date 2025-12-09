import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';

export const getStatusBadge = (status: string) => {
  const colors: Record<string, string> = {
    deployed: 'bg-black text-white',
    pending: 'bg-white text-black border border-black',
    error: 'bg-black text-white',
    running: 'bg-black text-white animate-pulse',
    completed: 'bg-white text-black border-2 border-black',
    completed_with_errors: 'bg-gray-200 text-black border border-black', // Success but with warnings
    failed: 'bg-black text-white',
    cancelled: 'bg-gray-400 text-white',
    queued: 'bg-white text-black border border-gray-400',
  };
  return colors[status] || 'bg-gray-100 text-black border border-gray-300';
};

export const getStatusIcon = (status: string) => {
  switch (status) {
    case 'running':
      return <Loader2 className="w-2.5 h-2.5 animate-spin" />;
    case 'completed':
      return <CheckCircle className="w-2.5 h-2.5" />;
    case 'completed_with_errors':
      return <AlertCircle className="w-2.5 h-2.5" />; // Warning icon for success with issues
    case 'failed':
    case 'error':
      return <XCircle className="w-2.5 h-2.5" />;
    case 'cancelled':
      return <AlertCircle className="w-2.5 h-2.5" />;
    case 'queued':
      return <Clock className="w-2.5 h-2.5" />;
    default:
      return <Activity className="w-2.5 h-2.5" />;
  }
};

export const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};
