import React from 'react';
import { cn } from '@/lib/utils';

interface AnimatedBadgeProps {
  status: 'deployed' | 'running' | 'paused' | 'failed' | 'completed' | 'queued';
  children: React.ReactNode;
  className?: string;
}

export function AnimatedBadge({ status, children, className }: AnimatedBadgeProps) {
  const statusStyles = {
    deployed: {
      base: 'bg-green-50 text-green-700 border-green-200',
      dot: 'bg-green-500',
      pulse: false,
    },
    running: {
      base: 'bg-blue-50 text-blue-700 border-blue-200',
      dot: 'bg-blue-500',
      pulse: true,
    },
    paused: {
      base: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      dot: 'bg-yellow-500',
      pulse: false,
    },
    failed: {
      base: 'bg-red-50 text-red-700 border-red-200',
      dot: 'bg-red-500',
      pulse: false,
    },
    completed: {
      base: 'bg-gray-50 text-gray-700 border-gray-200',
      dot: 'bg-gray-500',
      pulse: false,
    },
    queued: {
      base: 'bg-purple-50 text-purple-700 border-purple-200',
      dot: 'bg-purple-500',
      pulse: true,
    },
  };

  const style = statusStyles[status] || statusStyles.deployed;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-200',
        style.base,
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        {style.pulse && (
          <span
            className={cn(
              'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
              style.dot
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex rounded-full h-2 w-2',
            style.dot
          )}
        />
      </span>
      {children}
    </div>
  );
}