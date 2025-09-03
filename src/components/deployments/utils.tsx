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
    pending: 'bg-gray-200 text-black',
    error: 'bg-red-800 text-white',
    running: 'bg-black text-white',
    completed: 'bg-black text-white',
    completed_with_errors: 'bg-orange-600 text-white', // Success but with warnings
    failed: 'bg-red-600 text-white',
    cancelled: 'bg-gray-600 text-white',
    queued: 'bg-gray-400 text-white',
  };
  return colors[status] || 'bg-gray-100 text-black';
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
