'use client';

import { useOrganization, useOrganizationList } from '@clerk/nextjs';
import { Building2, Check } from 'lucide-react';
import { useState } from 'react';

export function CustomOrgSwitcher() {
  const { organization } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList();
  const [isOpen, setIsOpen] = useState(false);

  // Get all organizations the user is a member of
  const allOrgs = userMemberships?.data || [];

  if (!organization || allOrgs.length === 0) {
    return null;
  }

  const handleSelectOrg = async (orgId: string) => {
    if (setActive) {
      await setActive({ organization: orgId });
      setIsOpen(false);
      window.location.href = '/';
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm border border-black rounded-md hover:bg-gray-50 flex items-center gap-2 font-mono"
      >
        <Building2 className="w-4 h-4" />
        <span className="truncate max-w-[150px]">{organization.name}</span>
        <span className="text-xs text-gray-500">▼</span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-64 bg-white border-2 border-black shadow-lg z-50 max-h-96 overflow-y-auto">
            <div className="bg-black text-white px-4 py-2 font-mono text-xs uppercase">
              Switch Organization
            </div>

            <div className="divide-y divide-gray-200">
              {/* Default (All) option */}
              <button
                onClick={() => handleSelectOrg('default')}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="font-mono text-sm">Default (All)</span>
              </button>

              {/* All organizations */}
              {allOrgs.map((org) => {
                const isActive = org.organization.id === organization.id;
                return (
                  <button
                    key={org.organization.id}
                    onClick={() => handleSelectOrg(org.organization.id)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Building2 className="w-4 h-4 flex-shrink-0" />
                      <span className="font-mono text-sm truncate">
                        {org.organization.name}
                      </span>
                    </div>
                    {isActive && <Check className="w-4 h-4 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
