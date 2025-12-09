'use client';

import { Sidebar } from '@/components/navigation/Sidebar';
import { ReactNode, useState, useEffect } from 'react';
import { useAuth, useOrganizationList } from '@clerk/nextjs';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  // Initialize with correct state from localStorage to prevent flicker
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      return isCollapsed ? 'ml-16' : 'ml-64';
    }
    return 'ml-64';
  });
  const [isMounted, setIsMounted] = useState(false);
  const { orgId, userId } = useAuth();
  const { userMemberships, setActive, isLoaded } = useOrganizationList({
    userMemberships: {
      infinite: true,
    },
  });
  const [hasAttemptedFallback, setHasAttemptedFallback] = useState(false);

  // Auto-set the first organization if user has no active org
  useEffect(() => {
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
    } else if (isLoaded && !orgId && !hasAttemptedFallback) {
      console.warn('[DashboardLayout] No organization memberships from Clerk hook - checking Clerk API directly');
      setHasAttemptedFallback(true);

      // Fallback: Check Clerk API directly for memberships
      if (userId) {
        fetch(`https://api.clerk.com/v1/users/${userId}/organization_memberships`, {
          headers: {
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}`,
          }
        })
        .then(res => res.json())
        .then(data => {
          const memberships = Array.isArray(data) ? data : data.data || [];
          console.log('[DashboardLayout] Clerk API returned memberships:', memberships.length);

          if (memberships.length > 0 && !orgId) {
            const firstOrg = memberships[0].organization;
            console.log(`[DashboardLayout] Setting org from API: ${firstOrg.name} (${firstOrg.id})`);
            setActive?.({ organization: firstOrg.id });
          }
        })
        .catch(error => {
          console.error('[DashboardLayout] Failed to fetch memberships from Clerk API:', error);
        });
      }
    }
  }, [isLoaded, orgId, userMemberships, setActive, userId, hasAttemptedFallback]);

  // Set mounted state
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Listen for sidebar state changes (we'll use localStorage for persistence)
  useEffect(() => {
    if (!isMounted) return;

    const checkSidebarState = () => {
      const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      setSidebarWidth(isCollapsed ? 'ml-16' : 'ml-64');
    };

    // Don't check initial state - already initialized correctly

    // Listen for storage events from other tabs
    window.addEventListener('storage', checkSidebarState);

    // Custom event for same-tab updates
    const handleSidebarToggle = () => checkSidebarState();
    window.addEventListener('sidebarToggle', handleSidebarToggle);

    return () => {
      window.removeEventListener('storage', checkSidebarState);
      window.removeEventListener('sidebarToggle', handleSidebarToggle);
    };
  }, [isMounted]);

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Sidebar />
      <main className={`${sidebarWidth} transition-all duration-200`}>
        {children}
      </main>
    </div>
  );
}