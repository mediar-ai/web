'use client';

import { Sidebar } from '@/components/navigation/Sidebar';
import { ReactNode, useState, useEffect } from 'react';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState('ml-64');

  // Listen for sidebar state changes (we'll use localStorage for persistence)
  useEffect(() => {
    const checkSidebarState = () => {
      const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      setSidebarWidth(isCollapsed ? 'ml-16' : 'ml-64');
    };

    checkSidebarState();
    window.addEventListener('storage', checkSidebarState);

    // Also check on click events to detect sidebar toggle
    const interval = setInterval(checkSidebarState, 100);

    return () => {
      window.removeEventListener('storage', checkSidebarState);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Sidebar />
      <main className={`${sidebarWidth} transition-[margin-left] duration-200`}>
        {children}
      </main>
    </div>
  );
}