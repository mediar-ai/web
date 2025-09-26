'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import {
  useAuth,
  useOrganization,
  useOrganizationList,
  useUser,
  OrganizationSwitcher,
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
  ChevronDown,
  Clock,
  Crown
} from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';

const MEDIAR_ORG_IDS = [
  'org_REDACTED',
  'org_REDACTED',
];

export default function AdminPage() {
  const { isLoaded } = useAuth();
  const { organization, membership, invitationList, membershipList } = useOrganization({
    invitationList: {},
    membershipList: {}
  });
  const { organizationList, setActive } = useOrganizationList();
  const { user } = useUser();
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showOrgProfile, setShowOrgProfile] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'members' | 'invitations' | 'settings'>('overview');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // Check if user is Mediar admin
  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isOrgAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const canManageOrg = isOrgAdmin;

  // Handle invite
  const handleInvite = async () => {
    if (!inviteEmail || !organization) return;

    setInviting(true);
    try {
      await organization.inviteMember({
        emailAddress: inviteEmail,
        role: 'org:member'
      });
      setInviteEmail('');
      // Refresh invitations list
      await invitationList?.revalidate();
    } catch (error) {
      console.error('Failed to invite member:', error);
      alert('Failed to send invitation. Please check the email address.');
    } finally {
      setInviting(false);
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

            {/* Organization Switcher */}
            <div className="flex items-center gap-4">
              <div className="border-2 border-black">
                <OrganizationSwitcher
                  hidePersonal
                  afterCreateOrganizationUrl="/admin"
                  afterSelectOrganizationUrl="/admin"
                  appearance={{
                    elements: {
                      rootBox: "font-mono",
                      organizationSwitcherTrigger: "px-4 py-2 font-mono hover:bg-gray-50"
                    }
                  }}
                />
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
        </div>

        {/* Current Organization Info */}
        {organization ? (
          <>
            <div className="border-2 border-black mb-6">
              <div className="bg-black text-white p-4">
                <h2 className="font-mono font-bold text-lg">CURRENT ORGANIZATION</h2>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="font-mono text-xs text-gray-600 mb-1">NAME</p>
                    <p className="font-mono font-bold">{organization.name}</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs text-gray-600 mb-1">ID</p>
                    <p className="font-mono text-xs break-all">{organization.id}</p>
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
                    <p className="font-mono font-bold">{membershipList?.count || 0}</p>
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
                      <p className="font-mono text-2xl font-bold">{membershipList?.count || 0}</p>
                      <p className="font-mono text-xs text-gray-600">ACTIVE MEMBERS</p>
                    </div>
                    <div className="border-2 border-black p-4">
                      <Mail className="w-6 h-6 mb-2" />
                      <p className="font-mono text-2xl font-bold">{invitationList?.count || 0}</p>
                      <p className="font-mono text-xs text-gray-600">PENDING INVITES</p>
                    </div>
                    <div className="border-2 border-black p-4">
                      <Building2 className="w-6 h-6 mb-2" />
                      <p className="font-mono text-2xl font-bold">{organizationList?.length || 1}</p>
                      <p className="font-mono text-xs text-gray-600">YOUR ORGS</p>
                    </div>
                  </div>

                  {/* All Your Organizations */}
                  {organizationList && organizationList.length > 1 && (
                    <div className="border-2 border-black">
                      <div className="bg-gray-50 p-4 border-b-2 border-black">
                        <h3 className="font-mono font-bold">ALL YOUR ORGANIZATIONS</h3>
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
                  <div className="bg-gray-50 p-4 border-b-2 border-black">
                    <h3 className="font-mono font-bold">ORGANIZATION MEMBERS</h3>
                  </div>
                  <div className="divide-y divide-gray-200">
                    {membershipList?.data?.map((member) => (
                      <div key={member.id} className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-mono font-bold">
                            {member.publicUserData?.firstName?.[0]?.toUpperCase() ||
                             member.publicUserData?.identifier?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="font-mono font-bold">
                              {member.publicUserData?.firstName} {member.publicUserData?.lastName}
                              {member.publicUserData?.userId === user?.id && (
                                <span className="ml-2 text-xs text-gray-600">(YOU)</span>
                              )}
                            </p>
                            <p className="font-mono text-xs text-gray-600">
                              {member.publicUserData?.identifier}
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
                          {canManageOrg && member.publicUserData?.userId !== user?.id && member.role !== 'org:owner' && (
                            <button
                              onClick={async () => {
                                if (confirm(`Remove ${member.publicUserData?.identifier} from organization?`)) {
                                  try {
                                    await organization.removeMember(member.publicUserData?.userId!);
                                    await membershipList?.revalidate();
                                  } catch (error) {
                                    console.error('Failed to remove member:', error);
                                    alert('Failed to remove member');
                                  }
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
                    {(!membershipList?.data || membershipList.data.length === 0) && (
                      <div className="p-8 text-center text-gray-500 font-mono">
                        No members found
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'invitations' && (
                <div className="space-y-4">
                  {canManageOrg && (
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
                        Inviting to: {organization.name}
                      </p>
                    </div>
                  )}

                  <div className="border-2 border-black">
                    <div className="bg-gray-50 p-4 border-b-2 border-black">
                      <h3 className="font-mono font-bold">PENDING INVITATIONS</h3>
                    </div>
                    <div className="divide-y divide-gray-200">
                      {invitationList?.data?.map((invitation) => (
                        <div key={invitation.id} className="p-4 flex items-center justify-between">
                          <div>
                            <p className="font-mono font-bold">{invitation.emailAddress}</p>
                            <p className="font-mono text-xs text-gray-600 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Invited {new Date(invitation.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="font-mono text-xs px-2 py-1 bg-yellow-100 text-yellow-800 border border-yellow-300">
                              PENDING
                            </span>
                            {canManageOrg && (
                              <button
                                onClick={async () => {
                                  if (confirm('Revoke this invitation?')) {
                                    try {
                                      await invitation.revoke();
                                      await invitationList?.revalidate();
                                    } catch (error) {
                                      console.error('Failed to revoke invitation:', error);
                                    }
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
                      {(!invitationList?.data || invitationList.data.length === 0) && (
                        <div className="p-8 text-center text-gray-500 font-mono">
                          No pending invitations
                        </div>
                      )}
                    </div>
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
                    <Link href="/internal/admin-backup" className="px-4 py-2 bg-red-600 text-white font-mono font-bold hover:bg-red-700">
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