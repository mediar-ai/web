'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Mail,
  Search,
  Trash2,
  RefreshCw,
  Building2,
  UserPlus,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';

interface Organization {
  id: string;
  name: string;
  clerk_organization_id: string;
}

interface Invitation {
  id: string;
  emailAddress: string;
  role: string;
  status: string;
  createdAt: string;
}

export default function AdminInvitationsPage() {
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  useEffect(() => {
    if (viewOrgId && organizations.length > 0) {
      const org = organizations.find(
        o => o.clerk_organization_id === viewOrgId || o.id === viewOrgId
      );
      if (org) setSelectedOrg(org);
    }
  }, [viewOrgId, organizations]);

  useEffect(() => {
    if (selectedOrg) {
      fetchInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
    }
  }, [selectedOrg]);

  const fetchOrganizations = async () => {
    try {
      const res = await fetch('/api/admin/organizations');
      if (res.ok) {
        const data = await res.json();
        setOrganizations(data.organizations || []);
      }
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
      toast.error('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvitations = async (orgId: string) => {
    setLoadingInvitations(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/invitations`);
      if (res.ok) {
        const data = await res.json();
        setInvitations(data.invitations || []);
      }
    } catch (error) {
      console.error('Failed to fetch invitations:', error);
      toast.error('Failed to load invitations');
    } finally {
      setLoadingInvitations(false);
    }
  };

  const sendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || !inviteEmail) return;

    setInviting(true);
    try {
      const res = await fetch(
        `/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/invitations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail }),
        }
      );
      if (res.ok) {
        toast.success('Invitation sent');
        setInviteEmail('');
        fetchInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to send invitation');
      }
    } catch (error) {
      toast.error('Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    if (!selectedOrg) return;
    if (!confirm('Are you sure you want to revoke this invitation?')) return;

    try {
      const res = await fetch(
        `/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/invitations/${invitationId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        toast.success('Invitation revoked');
        fetchInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
      } else {
        toast.error('Failed to revoke invitation');
      }
    } catch (error) {
      toast.error('Failed to revoke invitation');
    }
  };

  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Mail className="w-6 h-6" />
            INVITATIONS
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Manage pending invitations across all organizations
          </p>
        </div>
        <button
          onClick={() => {
            fetchOrganizations();
            if (selectedOrg) fetchInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
          }}
          className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Organization List */}
        <div className="border-2 border-black">
          <div className="p-3 border-b-2 border-black bg-black text-white">
            <span className="font-mono font-bold text-sm">ORGANIZATIONS</span>
          </div>
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search organizations..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center font-mono text-gray-600">Loading...</div>
            ) : filteredOrgs.length === 0 ? (
              <div className="p-4 text-center font-mono text-gray-600">No organizations found</div>
            ) : (
              filteredOrgs.map(org => (
                <button
                  key={org.id}
                  onClick={() => setSelectedOrg(org)}
                  className={`w-full p-3 text-left border-b border-gray-200 font-mono text-sm hover:bg-gray-50 transition-colors ${
                    selectedOrg?.id === org.id ? 'bg-black text-white hover:bg-black' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    <span className="truncate">{org.name}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Invitations List */}
        <div className="lg:col-span-2 border-2 border-black">
          <div className="p-3 border-b-2 border-black bg-black text-white flex items-center justify-between">
            <span className="font-mono font-bold text-sm">
              {selectedOrg ? `INVITATIONS - ${selectedOrg.name}` : 'SELECT AN ORGANIZATION'}
            </span>
            {invitations.length > 0 && (
              <span className="font-mono text-xs bg-white text-black px-2 py-0.5">
                {invitations.length}
              </span>
            )}
          </div>

          {!selectedOrg ? (
            <div className="p-8 text-center font-mono text-gray-600">
              Select an organization to view invitations
            </div>
          ) : (
            <>
              {/* Invite Form */}
              <form onSubmit={sendInvitation} className="p-4 border-b border-gray-200 flex gap-2">
                <input
                  type="email"
                  placeholder="Email address..."
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  className="flex-1 px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  required
                />
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 border-2 border-black bg-black text-white font-mono text-sm hover:bg-white hover:text-black transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  {inviting ? 'SENDING...' : 'INVITE'}
                </button>
              </form>

              {loadingInvitations ? (
                <div className="p-8 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto" />
                </div>
              ) : invitations.length === 0 ? (
                <div className="p-8 text-center font-mono text-gray-600">
                  No pending invitations
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {invitations.map(inv => (
                    <div key={inv.id} className="p-4 flex items-center justify-between">
                      <div>
                        <div className="font-mono font-bold">{inv.emailAddress}</div>
                        <div className="font-mono text-xs text-gray-400 mt-1 flex items-center gap-2">
                          <span className={`px-2 py-0.5 ${
                            inv.status === 'pending' ? 'bg-gray-100 border border-dashed border-gray-400' : 'bg-gray-200'
                          }`}>
                            {inv.status.toUpperCase()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(inv.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => revokeInvitation(inv.id)}
                        className="p-2 border border-black hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
