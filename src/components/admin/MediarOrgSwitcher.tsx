'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Shield, Building, TestTube, Building2 } from 'lucide-react';
import { useOrganization, useOrganizationList } from '@clerk/nextjs';

interface Organization {
  id: string;
  name: string;
  type: 'mediar' | 'customer' | 'test';
  workflowCount: number;
}

interface MediarOrgSwitcherProps {
  inSidebar?: boolean;
}

export function MediarOrgSwitcher({ inSidebar = false }: MediarOrgSwitcherProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentViewOrg, setCurrentViewOrg] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();

  useEffect(() => {
    checkAdminStatus();
  }, []);

  useEffect(() => {
    // Get current view org from URL
    const viewOrgId = searchParams.get('viewOrgId');
    setCurrentViewOrg(viewOrgId);
  }, [searchParams]);

  const checkAdminStatus = async () => {
    try {
      const response = await fetch('/api/admin/list-all-orgs');
      if (response.ok) {
        const data = await response.json();
        setIsAdmin(data.isMediarAdmin);
        setOrganizations(data.organizations || []);
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
    } finally {
      setLoading(false);
    }
  };

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

  console.log('[MediarOrgSwitcher] Debug info:', {
    isAdmin,
    inSidebar,
    loading,
    allUserOrgsCount: allUserOrgs.length,
    organizationName: organization?.name,
    allOrgNames: allUserOrgs.map(m => m.organization.name)
  });

  // For sidebar (both admins and non-admins), show ALL user orgs from Clerk
  if (inSidebar && !loading) {
    console.log('[MediarOrgSwitcher] Sidebar path (admin=' + isAdmin + '), showing', allUserOrgs.length, 'orgs');
    if (!organization || allUserOrgs.length === 0) return null;

    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-2 hover:bg-gray-100 transition-colors rounded p-1"
        >
          <Building2 className="w-4 h-4 flex-shrink-0" />
          <span className="font-mono text-sm truncate flex-1 text-left">
            {organization.name}
          </span>
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border-2 border-black shadow-lg z-50 max-h-96 overflow-y-auto">
              <div className="p-2 bg-black text-white font-mono text-xs uppercase">
                Switch Organization
              </div>

              {/* All user organizations from Clerk */}
              {allUserOrgs.map(membership => {
                const org = membership.organization;
                const isActive = org.id === organization.id;

                return (
                  <button
                    key={org.id}
                    onClick={async () => {
                      if (setActive) {
                        await setActive({ organization: org.id });
                        setIsOpen(false);
                        router.push('/dashboard');
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
    console.log('[MediarOrgSwitcher] Admin sidebar path, showing', allUserOrgs.length, 'orgs from Clerk');
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-2 hover:bg-gray-100 transition-colors rounded p-1"
        >
          <Building className="w-4 h-4 flex-shrink-0" />
          <span className="font-mono text-sm truncate flex-1 text-left">
            {organization?.name || 'Select Org'}
          </span>
          <ChevronDown className="w-4 h-4 flex-shrink-0" />
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border-2 border-black shadow-lg z-50 max-h-96 overflow-y-auto">
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
                      if (setActive) {
                        await setActive({ organization: org.id });
                        setIsOpen(false);
                        router.push('/dashboard');
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