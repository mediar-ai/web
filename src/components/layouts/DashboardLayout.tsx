'use client';

import { Sidebar } from '@/components/navigation/Sidebar';
import { ReactNode, useState, useEffect } from 'react';
import { useAuth, useOrganizationList } from '@clerk/nextjs';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState('ml-64');
  const { orgId } = useAuth();
  const { userMemberships, setActive, isLoaded } = useOrganizationList();

  // Auto-set the first organization if user has no active org
  useEffect(() => {
    console.log('[DashboardLayout] Auto-selection check:', {
      isLoaded,
      orgId,
      membershipCount: userMemberships?.data?.length,
      hasSetActive: !!setActive
    });

    if (isLoaded && !orgId && userMemberships?.data && userMemberships.data.length > 0) {
      const firstOrg = userMemberships.data[0];
      console.log(`[DashboardLayout] Auto-setting first organization: ${firstOrg.organization.name} (${firstOrg.organization.id})`);

      setActive?.({ organization: firstOrg.organization.id })
        .then(() => {
          console.log('[DashboardLayout] Organization set successfully');
        })
        .catch((error) => {
          console.error('[DashboardLayout] Failed to set organization:', error);
        });
    } else if (isLoaded && !orgId) {
      console.warn('[DashboardLayout] No organization to auto-select - user may have no memberships');
    }
  }, [isLoaded, orgId, userMemberships, setActive]);

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
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Sidebar />
      <main className={`${sidebarWidth} transition-all duration-200`}>
        {children}
      </main>
    </div>
  );
}