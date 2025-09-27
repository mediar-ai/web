'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import {
  useAuth,
  useOrganization,
  useOrganizationList,
  useUser,
  CreateOrganization
} from '@clerk/nextjs';
import {
  Shield,
  Building2,
  Users,
  Plus,
  Mail,
  Trash2,
  UserPlus,
  AlertCircle,
  X,
  Clock,
  Crown
} from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

function AdminPageContent() {
  const { isLoaded } = useAuth();
  const { organization, membership } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList();
  const { user } = useUser();
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'invitations'>('overview');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [allOrganizations, setAllOrganizations] = useState<any[]>([]);
  const [_loadingOrgs, setLoadingOrgs] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [orgMembers, setOrgMembers] = useState<any[]>([]);
  const [orgInvitations, setOrgInvitations] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  // Check if user is Mediar admin
  const hasMediarEmail = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;
  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isOrgAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const isGlobalAdmin = hasMediarEmail; // @mediar.ai users are always global admins

  // Fetch all organizations if global admin
  useEffect(() => {
    if (isGlobalAdmin) {
      fetchAllOrganizations();
    }
  }, [isGlobalAdmin]);


  // Set selected org based on viewOrgId or current org
  useEffect(() => {
    const fetchOrgDetails = async (orgId: string) => {
      try {
        // Fetch organization details from Clerk if we have viewOrgId
        const response = await fetch('/api/admin/organizations');
        if (response.ok) {
          const data = await response.json();
          const orgs = data.organizations || [];
          const targetOrg = orgs.find((org: any) =>
            org.clerk_organization_id === orgId || org.id === orgId
          );
          if (targetOrg) {
            setSelectedOrg(targetOrg);
            // Update allOrganizations if not already loaded
            if (allOrganizations.length === 0) {
              setAllOrganizations(orgs);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching organization details:', error);
      }
    };

    if (viewOrgId) {
      // When viewOrgId is set, fetch that specific org's details
      fetchOrgDetails(viewOrgId);
    } else if (organization) {
      // Use current organization if no viewOrgId
      setSelectedOrg({
        id: organization.id,
        name: organization.name,
        clerk_organization_id: organization.id,
        member_count: organization.membersCount || 0
      });
    }
  }, [viewOrgId, organization]);

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
  if (!isGlobalAdmin && !isOrgAdmin) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <div className="max-w-2xl mx-auto">
            <div className="border-2 border-black bg-white p-8 text-center">
              <Shield className="w-12 h-12 mx-auto mb-4" />
              <h1 className="font-mono font-bold text-2xl mb-2">ACCESS RESTRICTED</h1>
              <p className="font-mono text-gray-600">
                This section is only available to organization administrators or Mediar staff.
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
        {/* Header */}
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

                {isGlobalAdmin && (
                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <a
                      href="https://dashboard.clerk.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-white text-black border-2 border-black hover:bg-black hover:text-white font-mono font-bold transition-colors inline-flex items-center"
                    >
                      <Building2 className="w-4 h-4 mr-2" />
                      CLERK DASHBOARD
                    </a>
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
                      <p className="font-mono text-2xl font-bold">{isGlobalAdmin ? allOrganizations.length : (userMemberships?.data?.length || 1)}</p>
                      <p className="font-mono text-xs text-gray-600">ORGANIZATIONS</p>
                    </div>
                  </div>

                  {/* User's Organizations - Show for non-global admin */}
                  {!isGlobalAdmin && userMemberships?.data && userMemberships.data.length > 1 && (
                    <div className="border-2 border-black">
                      <div className="bg-gray-50 p-4 border-b-2 border-black">
                        <h3 className="font-mono font-bold">YOUR ORGANIZATIONS</h3>
                      </div>
                      <div className="divide-y divide-gray-200">
                        {userMemberships.data.map((org) => (
                          <div key={org.organization.id} className="p-4 flex items-center justify-between">
                            <div>
                              <p className="font-mono font-bold">{org.organization.name}</p>
                              <p className="font-mono text-xs text-gray-600">
                                Role: {org.role?.replace('org:', '').toUpperCase()}
                              </p>
                            </div>
                            {org.organization.id !== organization?.id && (
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
              <div className="p-4 bg-white">
                <CreateOrganization
                  afterCreateOrganizationUrl="/admin"
                  skipInvitationScreen={false}
                  appearance={{
                    elements: {
                      rootBox: "bg-white",
                      card: "border-0 shadow-none bg-white",
                      headerTitle: "font-mono font-bold text-black",
                      headerSubtitle: "font-mono text-gray-600",
                      formButtonPrimary: "bg-black hover:bg-gray-800 text-white font-mono",
                      formFieldInput: "border-2 border-black font-mono",
                      formFieldLabel: "font-mono text-black",
                      identityPreview: "border-2 border-black",
                      identityPreviewText: "font-mono",
                      footer: "bg-white",
                      footerActionLink: "text-black hover:underline"
                    },
                    layout: {
                      socialButtonsPlacement: "bottom",
                      socialButtonsVariant: "blockButton"
                    },
                    variables: {
                      colorPrimary: "#000000",
                      colorBackground: "#FFFFFF",
                      colorText: "#000000",
                      colorTextSecondary: "#666666",
                      colorInputBackground: "#FFFFFF",
                      colorInputText: "#000000",
                      borderRadius: "0px",
                      fontFamily: "monospace"
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

export default function AdminPage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </DashboardLayout>
    }>
      <AdminPageContent />
    </Suspense>
  );
}