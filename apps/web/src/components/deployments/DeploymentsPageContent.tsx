'use client';

import React from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DeploymentsPageContentProps {
  children: React.ReactNode;
}

export function DeploymentsPageContent({ children }: DeploymentsPageContentProps) {
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  return (
    <div className="flex-1 relative">
      {/* Floating trigger button that shows when sidebar is collapsed */}
      {isCollapsed && (
        <SidebarTrigger
          className={cn(
            "fixed top-4 left-4 z-50",
            "h-10 w-10",
            "bg-white border-2 border-black rounded-md",
            "hover:bg-black hover:text-white",
            "transition-all duration-200",
            "flex items-center justify-center"
          )}
        >
          <Menu className="h-5 w-5" />
        </SidebarTrigger>
      )}
      {children}
    </div>
  );
}