'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { DeploymentSidebar } from './DeploymentSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface ResizableSidebarProps {
  stats?: {
    total: number;
    running: number;
    paused: number;
    failed: number;
    automated: number;
  };
  selectedFilter?: string;
  onFilterChange?: (filter: string) => void;
  onCreateWorkflow?: () => void;
  canViewAlerts?: boolean;
  currentPage?: 'deployments' | 'alerts' | 'settings';
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

export function ResizableSidebar({
  defaultWidth = 280,
  minWidth = 200,
  maxWidth = 400,
  ...props
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(() => {
    // Try to load saved width from localStorage
    if (typeof window !== 'undefined') {
      const savedWidth = localStorage.getItem('sidebar-width');
      return savedWidth ? parseInt(savedWidth) : defaultWidth;
    }
    return defaultWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setWidth(newWidth);
      }
    },
    [isResizing, minWidth, maxWidth]
  );

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResizing);
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    return () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  // Save width to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebar-width', width.toString());
    }
  }, [width]);

  return (
    <SidebarProvider>
      <div
        ref={sidebarRef}
        className="relative h-full border-r border-gray-200"
        style={{ width: `${width}px`, minWidth: `${minWidth}px`, maxWidth: `${maxWidth}px` }}
      >
        <div className="h-full overflow-hidden">
          <DeploymentSidebar {...props} />
        </div>

        {/* Resize handle - only on the right edge of the sidebar */}
        <div
          className={cn(
            "absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors z-10",
            isResizing && "bg-blue-500"
          )}
          style={{ touchAction: 'none' }}
          onMouseDown={startResizing}
        />
      </div>
    </SidebarProvider>
  );
}