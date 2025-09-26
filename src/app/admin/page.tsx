'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { QuickInvite } from '@/components/admin/QuickInvite';
import { useAuth, useOrganization, useUser } from '@clerk/nextjs';
import { Shield, Building2, Users, Mail, Plus, Settings } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const MEDIAR_ORG_IDS = [
  'org_REDACTED',
  'org_REDACTED',
];

export default function AdminPage() {
  const { userId } = useAuth();
  const { organization, membership } = useOrganization();
  const { user } = useUser();
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [creating, setCreating] = useState(false);

  // Check if user is Mediar org admin
  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isAdmin = membership?.role === 'org:owner' || membership?.role === 'org:admin';
  const canAccess = isMediarOrg && isAdmin;

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="max-w-2xl mx-auto">
            <div className="border-2 border-black bg-white p-8 text-center">
              <Shield className="w-12 h-12 mx-auto mb-4" />
              <h1 className="font-mono font-bold text-2xl mb-2">ACCESS RESTRICTED</h1>
              <p className="font-mono text-gray-600">
                This section is only available to Mediar organization administrators.
              </p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const handleCreateOrg = async () => {
    if (!orgName.trim()) return;

    setCreating(true);
    try {
      // This would call Clerk API to create organization
      // For now, just a placeholder
      console.log('Creating org:', orgName);
      setOrgName('');
      setShowCreateOrg(false);
    } catch (error) {
      console.error('Failed to create org:', error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-mono font-bold text-3xl mb-2">ADMIN PORTAL</h1>
            <p className="font-mono text-gray-600">Mediar organization management</p>
          </div>

          {/* Admin Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Client Invitations */}
            <div className="border-2 border-black bg-white">
              <div className="p-4 bg-black text-white">
                <h2 className="font-mono font-bold flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  CLIENT INVITATIONS
                </h2>
              </div>
              <div className="p-6">
                <p className="font-mono text-sm text-gray-600 mb-4">
                  Send invitations to new clients to join the platform.
                </p>
                <QuickInvite />
              </div>
            </div>

            {/* Organization Management */}
            <div className="border-2 border-black bg-white">
              <div className="p-4 bg-black text-white">
                <h2 className="font-mono font-bold flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  ORGANIZATION MANAGEMENT
                </h2>
              </div>
              <div className="p-6">
                <p className="font-mono text-sm text-gray-600 mb-4">
                  Create and manage client organizations.
                </p>

                {!showCreateOrg ? (
                  <button
                    onClick={() => setShowCreateOrg(true)}
                    className="w-full bg-black text-white p-3 font-mono font-bold hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    CREATE NEW ORGANIZATION
                  </button>
                ) : (
                  <div className="space-y-4">
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Organization name"
                      className="w-full p-2 border-2 border-black font-mono focus:outline-none focus:ring-2 focus:ring-black"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateOrg}
                        disabled={creating || !orgName.trim()}
                        className={`flex-1 p-2 font-mono font-bold transition-colors ${
                          creating || !orgName.trim()
                            ? 'bg-gray-200 text-gray-500 border-2 border-gray-400'
                            : 'bg-black text-white hover:bg-gray-800'
                        }`}
                      >
                        {creating ? 'CREATING...' : 'CREATE'}
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateOrg(false);
                          setOrgName('');
                        }}
                        className="px-4 py-2 bg-white text-black border-2 border-black hover:bg-black hover:text-white font-mono font-bold transition-colors"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/settings/team" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5" />
                <div>
                  <h3 className="font-mono font-bold">TEAM MANAGEMENT</h3>
                  <p className="font-mono text-xs text-gray-600">Manage roles and permissions</p>
                </div>
              </div>
            </Link>

            <Link href="/notifications" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5" />
                <div>
                  <h3 className="font-mono font-bold">ALERT SETTINGS</h3>
                  <p className="font-mono text-xs text-gray-600">Configure notifications</p>
                </div>
              </div>
            </Link>

            <Link href="/deployments" className="block border-2 border-black p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5" />
                <div>
                  <h3 className="font-mono font-bold">DEPLOYMENTS</h3>
                  <p className="font-mono text-xs text-gray-600">Monitor all workflows</p>
                </div>
              </div>
            </Link>
          </div>

          {/* Current Organization Info */}
          <div className="mt-8 border-2 border-black bg-gray-50 p-6">
            <h3 className="font-mono font-bold mb-4">CURRENT SESSION</h3>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex">
                <span className="font-bold w-32">Organization:</span>
                <span>{organization?.name}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-32">Org ID:</span>
                <span className="font-mono text-xs bg-white px-2 py-1 border border-black">{organization?.id}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-32">User:</span>
                <span>{user?.fullName || user?.username}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-32">Role:</span>
                <span className="uppercase">{membership?.role?.replace('org:', '')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}