import React from 'react';
import { cn } from '@/lib/utils';

interface AnimatedBadgeProps {
  status: 'deployed' | 'running' | 'paused' | 'failed' | 'completed' | 'queued';
  children: React.ReactNode;
  className?: string;
}

export function AnimatedBadge({ status, children, className }: AnimatedBadgeProps) {
  // Black & white theme - status differentiated by border style and animation
  const statusStyles = {
    deployed: {
      base: 'bg-white text-black border-2 border-black',
      dot: 'bg-black',
      pulse: false,
    },
    running: {
      base: 'bg-black text-white border-2 border-black',
      dot: 'bg-white',
      pulse: true, // Pulsing indicates active execution
    },
    paused: {
      base: 'bg-gray-200 text-gray-800 border-2 border-gray-400',
      dot: 'bg-gray-500',
      pulse: false,
    },
    failed: {
      base: 'bg-black text-white border-2 border-black font-bold',
      dot: 'bg-white',
      pulse: false, // Bold font weight indicates error
    },
    completed: {
      base: 'bg-white text-black border-2 border-black',
      dot: 'bg-gray-400',
      pulse: false,
    },
    queued: {
      base: 'bg-gray-100 text-gray-800 border-2 border-dashed border-gray-400',
      dot: 'bg-gray-500',
      pulse: true, // Dashed border + pulse indicates waiting
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