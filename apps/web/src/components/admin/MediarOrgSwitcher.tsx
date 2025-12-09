'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Shield, Building, TestTube, Building2, Globe } from 'lucide-react';
import { useOrganization, useOrganizationList, useUser } from '@clerk/nextjs';

interface Organization {
  id: string;
  name: string;
  type: 'mediar' | 'customer' | 'test';
  workflowCount: number;
}

interface MediarOrgSwitcherProps {
  inSidebar?: boolean;
  isCollapsed?: boolean;
}

// Cache admin status globally to prevent refetching on every navigation
let adminStatusCache: { isAdmin: boolean; organizations: Organization[]; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function MediarOrgSwitcher({ inSidebar = false, isCollapsed = false }: MediarOrgSwitcherProps) {
  const [isAdmin, setIsAdmin] = useState(adminStatusCache?.isAdmin || false);
  const [organizations, setOrganizations] = useState<Organization[]>(adminStatusCache?.organizations || []);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(!adminStatusCache);
  const [currentViewOrg, setCurrentViewOrg] = useState<string | null>(null);
  const [isMediarAdmin, setIsMediarAdmin] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const { user } = useUser();

  const checkAdminStatus = useCallback(async () => {
    // Check if we have valid cached data
    if (adminStatusCache && (Date.now() - adminStatusCache.timestamp) < CACHE_DURATION) {
      setIsAdmin(adminStatusCache.isAdmin);
      setOrganizations(adminStatusCache.organizations);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/admin/list-all-orgs');
      if (response.ok) {
        const data = await response.json();
        setIsAdmin(data.isMediarAdmin);
        setOrganizations(data.organizations || []);

        // Update cache
        adminStatusCache = {
          isAdmin: data.isMediarAdmin,
          organizations: data.organizations || [],
          timestamp: Date.now()
        };
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAdminStatus();
  }, [checkAdminStatus]);

  useEffect(() => {
    // Get current view org from URL
    const viewOrgId = searchParams.get('viewOrgId');
    setCurrentViewOrg(viewOrgId);
  }, [searchParams]);

  // Check if user has @mediar.ai email
  useEffect(() => {
    if (user) {
      const hasMediarEmail = user.emailAddresses?.some(
        email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
      ) || false;
      setIsMediarAdmin(hasMediarEmail);
    }
  }, [user]);


  const handleOrgSwitch = (orgId: string | null) => {
    const current = new URLSearchParams(searchParams.toString());

    if (orgId) {
      current.set('viewOrgId', orgId);
    } else {
      current.delete('viewOrgId');
    }

    const search = current.toString();
    const query = search ? `?${search}` : '';

    router.push(`${window.location.pathname}${query}`);
    setIsOpen(false);

    // Refresh the page data
    router.refresh();
  };

  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: {
      infinite: true,
    },
  });
  const allUserOrgs = userMemberships?.data || [];

  // For sidebar (both admins and non-admins), show ALL user orgs from Clerk
  if (inSidebar && !loading) {
    if (!organization || allUserOrgs.length === 0) return null;

    const isViewingAllOrgs = currentViewOrg === 'ALL';
    const displayName = isViewingAllOrgs ? 'All Orgs' : organization.name;
    const DisplayIcon = isViewingAllOrgs ? Globe : Building2;

    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center gap-2 hover:bg-gray-100 transition-colors rounded p-1 ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title={isCollapsed ? displayName : undefined}
        >
          <DisplayIcon className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && (
            <>
              <span className="font-mono text-sm truncate flex-1 text-left">
                {displayName}
              </span>
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
            </>
          )}
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div className={`absolute top-full mt-1 ${isCollapsed ? 'left-12' : 'left-0 right-0'} bg-white border-2 border-black shadow-lg z-50 max-h-96 overflow-y-auto ${
              isCollapsed ? 'min-w-[240px]' : ''
            }`}>
              <div className="p-2 bg-black text-white font-mono text-xs uppercase">
                Switch Organization
              </div>

              {/* All Orgs option - only for Mediar admins */}
              {isMediarAdmin && (
                <>
                  <button
                    onClick={() => {
                      handleOrgSwitch('ALL');
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors ${
                      isViewingAllOrgs ? 'bg-gray-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Globe className="w-3 h-3" />
                      <div className="font-mono text-xs font-bold">
                        All Orgs
                      </div>
                      {isViewingAllOrgs && <span className="ml-auto text-xs">✓</span>}
                    </div>
                  </button>
                  <div className="border-t border-gray-200" />
                </>
              )}

              {/* All user organizations from Clerk */}
              {allUserOrgs.map(membership => {
                const org = membership.organization;
                const isActive = org.id === organization.id && !isViewingAllOrgs;

                return (
                  <button
                    key={org.id}
                    onClick={async () => {
                      setIsOpen(false);

                      // Special handling when switching FROM "All Orgs" view
                      if (isViewingAllOrgs) {
                        // Clear viewOrgId when leaving "All Orgs" view
                        const current = new URLSearchParams(searchParams.toString());
                        current.delete('viewOrgId');
                        const search = current.toString();
                        const query = search ? `?${search}` : '';

                        // Set the active org if it's different from current
                        if (setActive && org.id !== organization.id) {
                          await setActive({ organization: org.id });
                        }

                        // Always navigate and refresh when leaving "All Orgs" view
                        if (!window.location.pathname.includes('/dashboard')) {
                          router.push(`/dashboard${query}`);
                        } else {
                          router.push(`${window.location.pathname}${query}`);
                          // Force refresh to ensure data updates
                          setTimeout(() => router.refresh(), 50);
                        }
                      } else if (setActive && !isActive) {
                        // Normal org switching (not from "All Orgs")
                        // Clear viewOrgId when switching orgs
                        const current = new URLSearchParams(searchParams.toString());
                        current.delete('viewOrgId');
                        const search = current.toString();
                        const query = search ? `?${search}` : '';

                        await setActive({ organization: org.id });
                        // Only redirect if not already on dashboard
                        if (!window.location.pathname.includes('/dashboard')) {
                          router.push(`/dashboard${query}`);
                        } else {
                          // On dashboard - always refresh to load new org data
                          if (query !== window.location.search) {
                            router.push(`${window.location.pathname}${query}`);
                          }
                          router.refresh();
                        }
                      }
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors ${
                      isActive ? 'bg-gray-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3 h-3" />
                      <div className="font-mono text-xs truncate">
                        {org.name}
                      </div>
                      {isActive && <span className="ml-auto text-xs">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Don't show switcher for non-admins outside sidebar
  if (loading || !isAdmin) {
    return null;
  }

  const currentOrg = organizations.find(o => o.id === currentViewOrg);

  // Sidebar view - more compact (ADMIN PATH - use Clerk orgs instead of API)
  if (inSidebar) {
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-full flex items-center gap-2 hover:bg-gray-100 transition-colors rounded p-1 ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title={isCollapsed ? (organization?.name || 'Select Org') : undefined}
        >
          <Building className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && (
            <>
              <span className="font-mono text-sm truncate flex-1 text-left">
                {organization?.name || 'Select Org'}
              </span>
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
            </>
          )}
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div className={`absolute top-full mt-1 ${isCollapsed ? 'left-12' : 'left-0 right-0'} bg-white border-2 border-black shadow-lg z-50 max-h-96 overflow-y-auto ${
              isCollapsed ? 'min-w-[240px]' : ''
            }`}>
              <div className="p-2 bg-black text-white font-mono text-xs uppercase">
                Switch Organization
              </div>

              {/* All user organizations from Clerk */}
              {allUserOrgs.map(membership => {
                const org = membership.organization;
                const isActive = org.id === organization?.id;

                return (
                  <button
                    key={org.id}
                    onClick={async () => {
                      if (setActive && !isActive) {
                        setIsOpen(false);
                        await setActive({ organization: org.id });
                        // Only redirect if not already on dashboard
                        if (!window.location.pathname.includes('/dashboard')) {
                          router.push('/dashboard');
                        } else {
                          router.refresh();
                        }
                      } else {
                        setIsOpen(false);
                      }
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors ${
                      isActive ? 'bg-gray-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3 h-3" />
                      <div className="font-mono text-xs truncate">
                        {org.name}
                      </div>
                      {isActive && <span className="ml-auto text-xs">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // Page header view - original full-sized version
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-black text-white border-2 border-black hover:bg-gray-900 transition-colors font-mono text-sm"
      >
        <Shield className="w-4 h-4" />
        <span className="uppercase">
          {currentOrg ? `Viewing as: ${currentOrg.name}` : 'Mediar Admin View'}
        </span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 bg-white border-2 border-black shadow-lg z-50 min-w-[300px]">
          <div className="p-2 bg-black text-white font-mono text-xs uppercase">
            Organization Override
          </div>

          {/* Default Mediar view */}
          <button
            onClick={() => handleOrgSwitch(null)}
            className={`w-full px-4 py-2 text-left hover:bg-gray-100 transition-colors flex items-center justify-between ${
              !currentViewOrg ? 'bg-gray-100' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <div>
                <div className="font-mono text-sm font-bold">Default View</div>
                <div className="font-mono text-xs text-gray-600">All workflows (Mediar admin)</div>
              </div>
            </div>
          </button>

          <div className="border-t border-gray-200" />

          {/* Organization list */}
          {organizations.map(org => {
            const Icon = org.type === 'mediar' ? Shield :
                        org.type === 'test' ? TestTube : Building;

            return (
              <button
                key={org.id}
                onClick={() => handleOrgSwitch(org.id)}
                className={`w-full px-4 py-2 text-left hover:bg-gray-100 transition-colors ${
                  currentViewOrg === org.id ? 'bg-gray-100' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4" />
                    <div>
                      <div className="font-mono text-sm font-bold">{org.name}</div>
                      <div className="font-mono text-xs text-gray-600">
                        {org.workflowCount} workflow{org.workflowCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  {currentViewOrg === org.id && (
                    <div className="font-mono text-xs bg-black text-white px-2 py-1">
                      ACTIVE
                    </div>
                  )}
                </div>
              </button>
            );
          })}

          <div className="border-t border-gray-200 p-2 bg-gray-50">
            <div className="font-mono text-xs text-gray-600">
              As a Mediar admin, you can view any organization&apos;s workflows
            </div>
          </div>
        </div>
      )}
    </div>
  );
}