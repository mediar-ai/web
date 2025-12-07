'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Users,
  Search,
  Crown,
  Trash2,
  RefreshCw,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';

interface Organization {
  id: string;
  name: string;
  clerk_organization_id: string;
  member_count?: number;
}

interface Member {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  createdAt: string;
}

export default function AdminMembersPage() {
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
      fetchMembers(selectedOrg.clerk_organization_id || selectedOrg.id);
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

  const fetchMembers = async (orgId: string) => {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch (error) {
      console.error('Failed to fetch members:', error);
      toast.error('Failed to load members');
    } finally {
      setLoadingMembers(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!selectedOrg) return;
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const res = await fetch(
        `/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/members/${memberId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        toast.success('Member removed');
        fetchMembers(selectedOrg.clerk_organization_id || selectedOrg.id);
      } else {
        toast.error('Failed to remove member');
      }
    } catch (error) {
      toast.error('Failed to remove member');
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
            <Users className="w-6 h-6" />
            MEMBERS
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Manage organization members across all organizations
          </p>
        </div>
        <button
          onClick={() => {
            fetchOrganizations();
            if (selectedOrg) fetchMembers(selectedOrg.clerk_organization_id || selectedOrg.id);
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

        {/* Members List */}
        <div className="lg:col-span-2 border-2 border-black">
          <div className="p-3 border-b-2 border-black bg-black text-white flex items-center justify-between">
            <span className="font-mono font-bold text-sm">
              {selectedOrg ? `MEMBERS - ${selectedOrg.name}` : 'SELECT AN ORGANIZATION'}
            </span>
            {members.length > 0 && (
              <span className="font-mono text-xs bg-white text-black px-2 py-0.5">
                {members.length}
              </span>
            )}
          </div>
          {!selectedOrg ? (
            <div className="p-8 text-center font-mono text-gray-600">
              Select an organization to view members
            </div>
          ) : loadingMembers ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto" />
            </div>
          ) : members.length === 0 ? (
            <div className="p-8 text-center font-mono text-gray-600">
              No members found
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {members.map(member => (
                <div key={member.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-mono font-bold flex items-center gap-2">
                      {member.firstName} {member.lastName}
                      {member.role === 'org:admin' && (
                        <Crown className="w-4 h-4 text-yellow-600" />
                      )}
                    </div>
                    <div className="font-mono text-sm text-gray-600">{member.email}</div>
                    <div className="font-mono text-xs text-gray-400 mt-1">
                      Role: {member.role} | Joined: {new Date(member.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => removeMember(member.id)}
                    className="p-2 border border-black hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
