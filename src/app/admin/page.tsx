'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import {
  useAuth,
  useOrganization,
  useOrganizationList,
  useUser,
  CreateOrganization,
  OrganizationProfile
} from '@clerk/nextjs';
import {
  Shield,
  Building2,
  Users,
  Plus,
  Settings,
  Mail,
  Trash2,
  UserPlus,
  AlertCircle,
  X,
  Clock,
  Crown,
  ChevronDown
} from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';

const MEDIAR_ORG_IDS = [
  'org_2yydAO45WOB4RaCE4F4BNUPtw9c',
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD',
];

export default function AdminPage() {
  const { isLoaded } = useAuth();
  const { organization, membership, membershipList } = useOrganization({
    membershipList: {}
  });
  const { organizationList, setActive } = useOrganizationList();
  const { user } = useUser();
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showOrgProfile, setShowOrgProfile] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'invitations'>('overview');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [allOrganizations, setAllOrganizations] = useState<any[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const [orgMembers, setOrgMembers] = useState<any[]>([]);
  const [orgInvitations, setOrgInvitations] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  // Check if user is Mediar admin
  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isOrgAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const canManageOrg = isOrgAdmin;
  const isGlobalAdmin = isMediarOrg && isOrgAdmin;

  // Fetch all organizations if global admin
  useEffect(() => {
    if (isGlobalAdmin) {
      fetchAllOrganizations();
    }
  }, [isGlobalAdmin]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showOrgDropdown && !(e.target as Element).closest('.org-dropdown')) {
        setShowOrgDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showOrgDropdown]);

  // Set initial selected org
  useEffect(() => {
    if (organization && !selectedOrg) {
      setSelectedOrg({
        id: organization.id,
        name: organization.name,
        clerk_organization_id: organization.id,
        member_count: membershipList?.count || 0
      });
    }
  }, [organization, membershipList, selectedOrg]);

  // Fetch members and invitations when selected org changes
  useEffect(() => {
    if (selectedOrg && isGlobalAdmin) {
      fetchOrgMembers(selectedOrg.clerk_organization_id || selectedOrg.id);
      fetchOrgInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
    }
  }, [selectedOrg, isGlobalAdmin]);

  const fetchAllOrganizations = async () => {
    setLoadingOrgs(true);
    try {
      const response = await fetch('/api/admin/organizations');
      if (response.ok) {
        const data = await response.json();
        setAllOrganizations(data.organizations || []);
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
    } finally {
      setLoadingOrgs(false);
    }
  };

  const fetchOrgMembers = async (orgId: string) => {
    setLoadingMembers(true);
    try {
      const response = await fetch(`/api/admin/organizations/${orgId}/members`);
      if (response.ok) {
        const data = await response.json();
        setOrgMembers(data.members || []);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoadingMembers(false);
    }
  };

  const fetchOrgInvitations = async (orgId: string) => {
    setLoadingInvitations(true);
    try {
      const response = await fetch(`/api/admin/organizations/${orgId}/invitations`);
      if (response.ok) {
        const data = await response.json();
        setOrgInvitations(data.invitations || []);
      }
    } catch (error) {
      console.error('Error fetching invitations:', error);
    } finally {
      setLoadingInvitations(false);
    }
  };

  // Handle invite for any organization
  const handleInvite = async () => {
    if (!inviteEmail || !selectedOrg) return;

    setInviting(true);
    try {
      const response = await fetch(`/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: 'org:member' })
      });

      if (response.ok) {
        setInviteEmail('');
        // Refresh invitations
        await fetchOrgInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
      } else {
        alert('Failed to send invitation. Please check the email address.');
      }
    } catch (error) {
      console.error('Failed to invite member:', error);
      alert('Failed to send invitation.');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedOrg) return;

    try {
      const response = await fetch(`/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: userId })
      });

      if (response.ok) {
        await fetchOrgMembers(selectedOrg.clerk_organization_id || selectedOrg.id);
      } else {
        alert('Failed to remove member');
      }
    } catch (error) {
      console.error('Failed to remove member:', error);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!selectedOrg) return;

    try {
      const response = await fetch(`/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/invitations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId })
      });

      if (response.ok) {
        await fetchOrgInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
      }
    } catch (error) {
      console.error('Failed to revoke invitation:', error);
    }
  };

  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </DashboardLayout>
    );
  }

  // Show access denied if not admin
  if (!isOrgAdmin && !isMediarOrg) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="max-w-2xl mx-auto">
            <div className="border-2 border-black bg-white p-8 text-center">
              <Shield className="w-12 h-12 mx-auto mb-4" />
              <h1 className="font-mono font-bold text-2xl mb-2">ACCESS RESTRICTED</h1>
              <p className="font-mono text-gray-600">
                This section is only available to organization administrators.
              </p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header with Org Switcher */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="font-mono font-bold text-3xl mb-2 flex items-center gap-2">
                <Shield className="w-8 h-8" />
                Admin Portal
              </h1>
              <p className="font-mono text-gray-600">
                Manage organizations and team members
              </p>
            </div>

            {/* Custom Organization Dropdown for Global Admins */}
            <div className="flex items-center gap-4">
              {isGlobalAdmin ? (
                <div className="relative org-dropdown">
                  <button
                    onClick={() => setShowOrgDropdown(!showOrgDropdown)}
                    className="px-4 py-2 border-2 border-black bg-white hover:bg-gray-50 font-mono flex items-center gap-2 min-w-[200px]"
                  >
                    <div className="w-6 h-6 bg-black text-white rounded flex items-center justify-center text-xs font-bold">
                      {selectedOrg?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="flex-1 text-left">{selectedOrg?.name || 'Select Org'}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {showOrgDropdown && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-white border-2 border-black max-h-96 overflow-y-auto z-50 min-w-[300px]">
                      <div className="p-2 border-b border-gray-200 bg-gray-50">
                        <p className="font-mono text-xs text-gray-600">ALL ORGANIZATIONS</p>
                      </div>
                      {loadingOrgs ? (
                        <div className="p-4 text-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900 mx-auto"></div>
                        </div>
                      ) : (
                        allOrganizations.map((org) => (
                          <button
                            key={org.id}
                            onClick={() => {
                              setSelectedOrg(org);
                              setShowOrgDropdown(false);
                              // If switching to current user's org, update via Clerk
                              if (organizationList?.find(o => o.organization.id === org.clerk_organization_id)) {
                                setActive?.({ organization: org.clerk_organization_id });
                              }
                            }}
                            className={`w-full px-3 py-2 text-left hover:bg-gray-50 font-mono text-sm flex items-center gap-2 ${
                              selectedOrg?.id === org.id ? 'bg-black text-white' : ''
                            }`}
                          >
                            <div className={`w-6 h-6 ${selectedOrg?.id === org.id ? 'bg-white text-black' : 'bg-black text-white'} rounded flex items-center justify-center text-xs font-bold`}>
                              {org.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <span className="flex-1">{org.name}</span>
                            <span className="text-xs opacity-60">{org.member_count || 0} members</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // For non-global admins, just show current org name
                <div className="px-4 py-2 border-2 border-black bg-white font-mono flex items-center gap-2">
                  <div className="w-6 h-6 bg-black text-white rounded flex items-center justify-center text-xs font-bold">
                    {organization?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span>{organization?.name || 'No Organization'}</span>
                </div>
              )}

              <button
                onClick={() => setShowCreateOrg(true)}
                className="px-4 py-2 bg-black text-white font-mono font-bold hover:bg-gray-800 flex items-center gap-2"
                title="Create new organization"
              >
                <Plus className="w-4 h-4" />
                NEW ORG
              </button>
            </div>
          </div>
        </div>

        {/* Current Organization Info */}
        {selectedOrg ? (
          <>
            <div className="border-2 border-black mb-6">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold text-lg">CURRENT ORGANIZATION</h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="font-mono text-xs text-gray-600 mb-1">NAME</p>
                    <p className="font-mono font-bold">{selectedOrg.name}</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-gray-600 mb-1">ID</p>
                    <p className="font-mono text-xs break-all">{selectedOrg.clerk_organization_id || selectedOrg.id}</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-gray-600 mb-1">YOUR ROLE</p>
                    <p className="font-mono font-bold flex items-center gap-1">
                      {membership?.role === 'org:owner' && <Crown className="w-4 h-4" />}
                      {membership?.role?.replace('org:', '').toUpperCase()}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-gray-600 mb-1">MEMBERS</p>
                    <p className="font-mono font-bold">{selectedOrg.member_count || 0}</p>
                  </div>
                </div>

                {canManageOrg && (
                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => setShowOrgProfile(true)}
                      className="px-4 py-2 bg-white text-black border-2 border-black hover:bg-black hover:text-white font-mono font-bold transition-colors"
                    >
                      <Settings className="w-4 h-4 inline mr-2" />
                      EDIT SETTINGS
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="border-b-2 border-black mb-6">
              <div className="flex gap-0">
                {['overview', 'members', 'invitations'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`px-6 py-3 font-mono font-bold transition-colors border-r-2 border-black last:border-r-0 ${
                      activeTab === tab
                        ? 'bg-black text-white'
                        : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div className="space-y-6">
              {activeTab === 'overview' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border-2 border-black p-4">
                      <Users className="w-6 h-6 mb-2" />
                      <p className="font-mono text-2xl font-bold">{orgMembers.length}</p>
                      <p className="font-mono text-xs text-gray-600">ACTIVE MEMBERS</p>
                    </div>
                    <div className="border-2 border-black p-4">
                      <Mail className="w-6 h-6 mb-2" />
                      <p className="font-mono text-2xl font-bold">{orgInvitations.length}</p>
                      <p className="font-mono text-xs text-gray-600">PENDING INVITES</p>
                    </div>
                    <div className="border-2 border-black p-4">
                      <Building2 className="w-6 h-6 mb-2" />
                      <p className="font-mono text-2xl font-bold">{isGlobalAdmin ? allOrganizations.length : (organizationList?.length || 1)}</p>
                      <p className="font-mono text-xs text-gray-600">{isGlobalAdmin ? 'ALL ORGS' : 'YOUR ORGS'}</p>
                    </div>
                  </div>

                  {/* All Organizations - Show for Global Admin */}
                  {isGlobalAdmin && (
                    <div className="border-2 border-black">
                      <div className="bg-gray-50 p-4 border-b-2 border-black flex items-center justify-between">
                        <h3 className="font-mono font-bold">QUICK STATS</h3>
                        <button
                          onClick={() => setActiveTab('organizations')}
                          className="font-mono text-xs underline hover:no-underline"
                        >
                          VIEW ALL ORGANIZATIONS →
                        </button>
                      </div>
                      <div className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <p className="font-mono text-2xl font-bold">{allOrganizations.length}</p>
                            <p className="font-mono text-xs text-gray-600">TOTAL ORGS</p>
                          </div>
                          <div>
                            <p className="font-mono text-2xl font-bold">
                              {allOrganizations.filter(org => {
                                const created = new Date(org.created_at);
                                const thirtyDaysAgo = new Date();
                                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                                return created >= thirtyDaysAgo;
                              }).length}
                            </p>
                            <p className="font-mono text-xs text-gray-600">NEW (30 DAYS)</p>
                          </div>
                          <div>
                            <p className="font-mono text-2xl font-bold">
                              {allOrganizations.reduce((sum, org) => sum + (org.member_count || 0), 0)}
                            </p>
                            <p className="font-mono text-xs text-gray-600">TOTAL USERS</p>
                          </div>
                          <div>
                            <p className="font-mono text-2xl font-bold">
                              {allOrganizations.filter(org => org.is_active !== false).length}
                            </p>
                            <p className="font-mono text-xs text-gray-600">ACTIVE</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* User's Organizations - Show for non-global admin */}
                  {!isGlobalAdmin && organizationList && organizationList.length > 1 && (
                    <div className="border-2 border-black">
                      <div className="bg-gray-50 p-4 border-b-2 border-black">
                        <h3 className="font-mono font-bold">YOUR ORGANIZATIONS</h3>
                      </div>
                      <div className="divide-y divide-gray-200">
                        {organizationList.map((org) => (
                          <div key={org.organization.id} className="p-4 flex items-center justify-between">
                            <div>
                              <p className="font-mono font-bold">{org.organization.name}</p>
                              <p className="font-mono text-xs text-gray-600">
                                Role: {org.membership?.role?.replace('org:', '').toUpperCase()}
                              </p>
                            </div>
                            {org.organization.id !== organization.id && (
                              <button
                                onClick={() => setActive?.({ organization: org.organization.id })}
                                className="px-3 py-1 font-mono text-xs border-2 border-black hover:bg-black hover:text-white"
                              >
                                SWITCH
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'members' && (
                <div className="border-2 border-black">
                  <div className="bg-gray-50 p-4 border-b-2 border-black flex items-center justify-between">
                    <h3 className="font-mono font-bold">ORGANIZATION MEMBERS</h3>
                    {isGlobalAdmin && (
                      <button
                        onClick={() => fetchOrgMembers(selectedOrg?.clerk_organization_id || selectedOrg?.id)}
                        className="px-2 py-1 font-mono text-xs border border-black hover:bg-black hover:text-white"
                      >
                        REFRESH
                      </button>
                    )}
                  </div>
                  {loadingMembers ? (
                    <div className="p-8 text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {orgMembers.map((member) => (
                        <div key={member.id} className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-mono font-bold">
                              {member.firstName?.[0]?.toUpperCase() ||
                               member.email?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div>
                              <p className="font-mono font-bold">
                                {member.firstName} {member.lastName}
                                {member.userId === user?.id && (
                                  <span className="ml-2 text-xs text-gray-600">(YOU)</span>
                                )}
                              </p>
                              <p className="font-mono text-xs text-gray-600">
                                {member.email}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className={`font-mono text-xs px-2 py-1 border ${
                              member.role === 'org:owner' ? 'border-black bg-black text-white' :
                              member.role === 'org:admin' ? 'border-black bg-gray-100' :
                              'border-gray-400'
                            }`}>
                              {member.role === 'org:owner' && <Crown className="w-3 h-3 inline mr-1" />}
                              {member.role.replace('org:', '').toUpperCase()}
                            </span>
                            {isGlobalAdmin && member.userId !== user?.id && member.role !== 'org:owner' && (
                              <button
                                onClick={async () => {
                                  if (confirm(`Remove ${member.email} from organization?`)) {
                                    await handleRemoveMember(member.userId);
                                  }
                                }}
                                className="p-2 text-red-600 hover:bg-red-50 rounded"
                                title="Remove member"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {orgMembers.length === 0 && (
                        <div className="p-8 text-center text-gray-500 font-mono">
                          No members found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'invitations' && (
                <div className="space-y-4">
                  {isGlobalAdmin && (
                    <div className="border-2 border-black p-4">
                      <h3 className="font-mono font-bold mb-4">INVITE NEW MEMBER</h3>
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="Enter email address"
                          className="flex-1 px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                          disabled={inviting}
                        />
                        <button
                          onClick={handleInvite}
                          disabled={inviting || !inviteEmail}
                          className={`px-4 py-2 font-mono font-bold flex items-center gap-2 ${
                            inviting || !inviteEmail
                              ? 'bg-gray-200 text-gray-500 border-2 border-gray-400'
                              : 'bg-black text-white hover:bg-gray-800'
                          }`}
                        >
                          <UserPlus className="w-4 h-4" />
                          {inviting ? 'SENDING...' : 'SEND INVITE'}
                        </button>
                      </div>
                      <p className="font-mono text-xs text-gray-600 mt-2">
                        Inviting to: {selectedOrg.name}
                      </p>
                    </div>
                  )}

                  <div className="border-2 border-black">
                    <div className="bg-gray-50 p-4 border-b-2 border-black flex items-center justify-between">
                      <h3 className="font-mono font-bold">PENDING INVITATIONS</h3>
                      {isGlobalAdmin && (
                        <button
                          onClick={() => fetchOrgInvitations(selectedOrg?.clerk_organization_id || selectedOrg?.id)}
                          className="px-2 py-1 font-mono text-xs border border-black hover:bg-black hover:text-white"
                        >
                          REFRESH
                        </button>
                      )}
                    </div>
                    {loadingInvitations ? (
                      <div className="p-8 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {orgInvitations.map((invitation) => (
                          <div key={invitation.id} className="p-4 flex items-center justify-between">
                            <div>
                              <p className="font-mono font-bold">{invitation.email}</p>
                              <p className="font-mono text-xs text-gray-600 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Invited {new Date(invitation.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="font-mono text-xs px-2 py-1 bg-yellow-100 text-yellow-800 border border-yellow-300">
                                PENDING
                              </span>
                              {isGlobalAdmin && (
                                <button
                                  onClick={async () => {
                                    if (confirm('Revoke this invitation?')) {
                                      await handleRevokeInvitation(invitation.id);
                                    }
                                  }}
                                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                                  title="Revoke invitation"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        {orgInvitations.length === 0 && (
                          <div className="p-8 text-center text-gray-500 font-mono">
                            No pending invitations
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mediar Admin Section */}
            {isMediarOrg && (
              <div className="mt-8 border-2 border-red-600">
                <div className="bg-red-600 text-white p-4">
                  <h2 className="font-mono font-bold text-lg flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    MEDIAR GLOBAL ADMIN
                  </h2>
                </div>
                <div className="p-6 space-y-4">
                  <p className="font-mono text-sm">
                    You have global admin access. You can see and manage all organizations and workflows.
                  </p>
                  <div className="flex gap-4">
                    <Link href="/admin-old" className="px-4 py-2 bg-red-600 text-white font-mono font-bold hover:bg-red-700">
                      LEGACY ADMIN
                    </Link>
                    <Link href="/notifications" className="px-4 py-2 bg-white text-red-600 border-2 border-red-600 font-mono font-bold hover:bg-red-50">
                      ALERT SETTINGS
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="border-2 border-black p-8 text-center">
            <Building2 className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="font-mono text-gray-600 mb-4">No organization selected</p>
            <button
              onClick={() => setShowCreateOrg(true)}
              className="px-4 py-2 bg-black text-white font-mono font-bold hover:bg-gray-800"
            >
              CREATE ORGANIZATION
            </button>
          </div>
        )}

        {/* Create Organization Modal */}
        {showCreateOrg && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white border-2 border-black max-w-lg w-full">
              <div className="p-4 border-b-2 border-black flex items-center justify-between">
                <h2 className="font-mono font-bold">CREATE NEW ORGANIZATION</h2>
                <button
                  onClick={() => setShowCreateOrg(false)}
                  className="p-1 hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4">
                <CreateOrganization
                  afterCreateOrganizationUrl="/admin"
                  skipInvitationScreen={false}
                  appearance={{
                    elements: {
                      formButtonPrimary: "bg-black hover:bg-gray-800",
                      card: "border-0 shadow-none"
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Organization Profile Modal */}
        {showOrgProfile && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white border-2 border-black max-w-4xl w-full max-h-[80vh] overflow-y-auto">
              <div className="p-4 border-b-2 border-black flex items-center justify-between sticky top-0 bg-white">
                <h2 className="font-mono font-bold">ORGANIZATION SETTINGS</h2>
                <button
                  onClick={() => setShowOrgProfile(false)}
                  className="p-1 hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4">
                <OrganizationProfile
                  appearance={{
                    elements: {
                      formButtonPrimary: "bg-black hover:bg-gray-800",
                      card: "border-0 shadow-none",
                      navbar: "hidden"
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}