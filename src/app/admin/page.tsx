'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import {
  useAuth,
  useOrganization,
  useOrganizationList,
  useUser,
  CreateOrganization,
} from '@clerk/nextjs';
import {
  Shield,
  Building2,
  Users,
  Plus,
  Mail,
  Trash2,
  UserPlus,
  X,
  Clock,
  Crown,
  Server,
  Activity,
  Edit2,
  Check,
  RefreshCw,
  Cpu,
  Search,
} from 'lucide-react';
// import Link from 'next/link';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { toast } from 'sonner';

function AdminPageContent() {
  const { isLoaded } = useAuth();
  const { organization, membership } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList();
  const { user } = useUser();
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'members' | 'invitations' | 'machines'
  >('overview');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [allOrganizations, setAllOrganizations] = useState<any[]>([]);
  const [_loadingOrgs, setLoadingOrgs] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [orgMembers, setOrgMembers] = useState<any[]>([]);
  const [orgInvitations, setOrgInvitations] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  // Machines state
  const [machines, setMachines] = useState<any[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [editingMachine, setEditingMachine] = useState<number | null>(null);
  const [editedMachineData, setEditedMachineData] = useState<any>({});
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [newMachine, setNewMachine] = useState({
    name: '',
    description: '',
    mcp_endpoint: '',
    management_endpoint: '',
    health_endpoint: '',
    machine_type: 'windows_vm',
    max_concurrent_executions: 1,
    priority: 5,
    region: '',
    tags: [] as string[],
    azure_resource_id: '',
  });

  // Machine organization assignment state
  const [editingMachineOrgs, setEditingMachineOrgs] = useState<number | null>(
    null
  );
  const [machineOrgAssignments, setMachineOrgAssignments] = useState<{
    [key: number]: string[];
  }>({});
  const [machineIsGlobal, setMachineIsGlobal] = useState<{
    [key: number]: boolean;
  }>({});
  const [orgSearchQuery, setOrgSearchQuery] = useState('');

  // Check if user is Mediar admin
  const hasMediarEmail =
    user?.emailAddresses?.some(email =>
      email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;
  const isMediarOrg =
    organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isOrgAdmin =
    membership?.role === 'org:admin' || membership?.role === 'org:owner';
  const isGlobalAdmin = hasMediarEmail; // @mediar.ai users are always global admins

  // Calculate uptime from created_at timestamp
  const _calculateUptime = (createdAt: string | null | undefined): string => {
    if (!createdAt) return '-';

    const created = new Date(createdAt);
    const now = new Date();
    const uptimeSeconds = Math.floor(
      (now.getTime() - created.getTime()) / 1000
    );

    if (uptimeSeconds <= 0) return '-';

    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  // Format time ago from timestamp
  const formatTimeAgo = (timestamp: string | null | undefined): string => {
    if (!timestamp) return '-';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  };

  // Copy to clipboard helper
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
    }
  };

  // Fetch all organizations if global admin
  useEffect(() => {
    if (isGlobalAdmin) {
      fetchAllOrganizations();
      fetchMachines();
    }
  }, [isGlobalAdmin]);

  // Set selected org based on viewOrgId or current org
  useEffect(() => {
    const fetchOrgDetails = async (orgId: string) => {
      try {
        console.log('[Admin] Fetching org details for viewOrgId:', orgId);

        // Fetch organization details from Clerk if we have viewOrgId
        const response = await fetch('/api/admin/organizations');
        if (response.ok) {
          const data = await response.json();
          const orgs = data.organizations || [];
          console.log('[Admin] Found organizations:', orgs.length);

          const targetOrg = orgs.find(
            (org: any) =>
              org.clerk_organization_id === orgId || org.id === orgId
          );

          if (targetOrg) {
            console.log('[Admin] Found target org:', targetOrg.name);
            setSelectedOrg(targetOrg);
            // Update allOrganizations if not already loaded
            if (allOrganizations.length === 0) {
              setAllOrganizations(orgs);
            }
          } else {
            console.log('[Admin] No org found for ID:', orgId);
            // If we can't find the org in the list but have viewOrgId,
            // try to create a minimal org object
            if (orgId === 'org_2yydAO45WOB4RaCE4F4BNUPtw9c') {
              setSelectedOrg({
                id: orgId,
                name: 'Mediar (Legacy/Dev)',
                clerk_organization_id: orgId,
                member_count: 0,
              });
            } else if (orgId === 'org_2yynzGa53bNM1GTPLp5mc2lYRyD') {
              setSelectedOrg({
                id: orgId,
                name: 'Mediar',
                clerk_organization_id: orgId,
                member_count: 0,
              });
            }
          }
        } else {
          console.error(
            '[Admin] Failed to fetch organizations:',
            response.status
          );
        }
      } catch (error) {
        console.error('[Admin] Error fetching organization details:', error);
      }
    };

    if (viewOrgId) {
      // When viewOrgId is set, fetch that specific org's details
      fetchOrgDetails(viewOrgId);
    } else if (organization) {
      // Use current organization if no viewOrgId
      console.log('[Admin] Using current org:', organization.name);
      setSelectedOrg({
        id: organization.id,
        name: organization.name,
        clerk_organization_id: organization.id,
        member_count: organization.membersCount || 0,
      });
    }
  }, [viewOrgId, organization, allOrganizations.length]);

  // Fetch members and invitations when selected org changes
  useEffect(() => {
    if (selectedOrg && isGlobalAdmin) {
      fetchOrgMembers(selectedOrg.clerk_organization_id || selectedOrg.id);
      fetchOrgInvitations(selectedOrg.clerk_organization_id || selectedOrg.id);
    }
  }, [selectedOrg, isGlobalAdmin]);

  // Machine Management Functions
  const fetchMachines = async () => {
    setLoadingMachines(true);
    try {
      // Include all machines, not just active ones
      // For admins, use show_all=true to bypass organization filtering
      const url = isGlobalAdmin
        ? '/api/machines?include_load=true&status=all&show_all=true'
        : '/api/machines?include_load=true&status=all';
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const fetchedMachines = data.machines || [];
        setMachines(fetchedMachines);

        // Fetch organization assignments for each machine
        const orgAssignments: { [key: number]: string[] } = {};
        const isGlobalFlags: { [key: number]: boolean } = {};

        for (const machine of fetchedMachines) {
          try {
            const orgResponse = await fetch(
              `/api/machines/${machine.id}/organizations`
            );
            if (orgResponse.ok) {
              const orgData = await orgResponse.json();
              orgAssignments[machine.id] = orgData.organizations.map(
                (o: any) => o.organization_id
              );
              isGlobalFlags[machine.id] = orgData.machine.is_global;
            }
          } catch (err) {
            console.error(
              `Error fetching orgs for machine ${machine.id}:`,
              err
            );
          }
        }

        setMachineOrgAssignments(orgAssignments);
        setMachineIsGlobal(isGlobalFlags);
      }
    } catch (error) {
      console.error('Error fetching machines:', error);
    } finally {
      setLoadingMachines(false);
    }
  };

  const handleAddMachine = async () => {
    try {
      const response = await fetch('/api/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMachine),
      });

      if (response.ok) {
        await fetchMachines();
        setShowAddMachine(false);
        setNewMachine({
          name: '',
          description: '',
          mcp_endpoint: '',
          management_endpoint: '',
          health_endpoint: '',
          machine_type: 'windows_vm',
          max_concurrent_executions: 1,
          priority: 5,
          region: '',
          tags: [],
          azure_resource_id: '',
        });
      } else {
        const error = await response.json();
        toast.error(`Failed to add machine: ${error.error}`);
      }
    } catch (error) {
      console.error('Error adding machine:', error);
      toast.error('Failed to add machine');
    }
  };

  const handleEditMachine = (machine: any) => {
    setEditingMachine(machine.id);
    setEditedMachineData({
      name: machine.name,
      description: machine.description || '',
      max_concurrent_executions: machine.max_concurrent_executions,
      priority: machine.priority,
      status: machine.status,
      region: machine.region || '',
      tags: machine.tags || [],
    });
  };

  const handleSaveMachine = async (machineId: number) => {
    try {
      const response = await fetch(`/api/machines/${machineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedMachineData),
      });

      if (response.ok) {
        await fetchMachines();
        setEditingMachine(null);
        setEditedMachineData({});
        toast.success('Machine updated successfully');
      } else {
        const error = await response.json();
        toast.error(`Failed to update machine: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating machine:', error);
      toast.error('Failed to update machine');
    }
  };

  const handleDeleteMachine = async (
    machineId: number,
    machineName: string
  ) => {
    if (!confirm(`Are you sure you want to delete machine "${machineName}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/machines/${machineId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchMachines();
      } else {
        const error = await response.json();
        if (error.running_executions) {
          if (
            confirm(
              `Machine has ${error.running_executions} running executions. Force delete?`
            )
          ) {
            const forceResponse = await fetch(
              `/api/machines/${machineId}?force=true`,
              {
                method: 'DELETE',
              }
            );
            if (forceResponse.ok) {
              await fetchMachines();
            }
          }
        } else {
          toast.error(`Failed to delete machine: ${error.error}`);
        }
      }
    } catch (error) {
      console.error('Error deleting machine:', error);
      toast.error('Failed to delete machine');
    }
  };

  const handleEditMachineOrgs = (machineId: number) => {
    setEditingMachineOrgs(machineId);
  };

  const handleSaveMachineOrgs = async (machineId: number) => {
    try {
      const isGlobal = machineIsGlobal[machineId] ?? false;
      const orgIds = machineOrgAssignments[machineId] || [];

      const response = await fetch(`/api/machines/${machineId}/organizations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_global: isGlobal,
          organization_ids: orgIds,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setEditingMachineOrgs(null);
        setOrgSearchQuery('');
        if (data.restart_required) {
          toast.success(
            'Organization assignments updated. VM restart required for changes to take effect.',
            {
              duration: 6000,
              description: data.restart_message,
            }
          );
        } else {
          toast.success('Organization assignments updated');
        }
        await fetchMachines();
      } else {
        const error = await response.json();
        toast.error(`Failed to update assignments: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating machine orgs:', error);
      toast.error('Failed to update organization assignments');
    }
  };

  const toggleMachineOrgAssignment = (machineId: number, orgId: string) => {
    setMachineOrgAssignments(prev => {
      const current = prev[machineId] || [];
      const newAssignments = current.includes(orgId)
        ? current.filter(id => id !== orgId)
        : [...current, orgId];
      return { ...prev, [machineId]: newAssignments };
    });
  };

  const toggleMachineIsGlobal = (machineId: number) => {
    setMachineIsGlobal(prev => ({
      ...prev,
      [machineId]: !(prev[machineId] ?? false),
    }));
  };

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
      const response = await fetch(
        `/api/admin/organizations/${orgId}/invitations`
      );
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
      const response = await fetch(
        `/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/invitations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail, role: 'org:member' }),
        }
      );

      if (response.ok) {
        setInviteEmail('');
        // Refresh invitations
        await fetchOrgInvitations(
          selectedOrg.clerk_organization_id || selectedOrg.id
        );
      } else {
        toast.error(
          'Failed to send invitation. Please check the email address.'
        );
      }
    } catch (error) {
      console.error('Failed to invite member:', error);
      toast.error('Failed to send invitation.');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedOrg) return;

    try {
      const response = await fetch(
        `/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/members`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: userId }),
        }
      );

      if (response.ok) {
        await fetchOrgMembers(
          selectedOrg.clerk_organization_id || selectedOrg.id
        );
      } else {
        toast.error('Failed to remove member');
      }
    } catch (error) {
      console.error('Failed to remove member:', error);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!selectedOrg) return;

    try {
      const response = await fetch(
        `/api/admin/organizations/${selectedOrg.clerk_organization_id || selectedOrg.id}/invitations`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invitationId }),
        }
      );

      if (response.ok) {
        await fetchOrgInvitations(
          selectedOrg.clerk_organization_id || selectedOrg.id
        );
      }
    } catch (error) {
      console.error('Failed to revoke invitation:', error);
    }
  };

  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="p-4">
          <div className="max-w-7xl mx-auto">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Show access denied if not admin
  if (!isGlobalAdmin && !isOrgAdmin) {
    return (
      <DashboardLayout>
        <div className="p-4">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-2xl mx-auto">
              <div className="border-2 border-black bg-white p-8 text-center">
                <Shield className="w-12 h-12 mx-auto mb-4" />
                <h1 className="font-mono font-bold text-2xl mb-2">
                  ACCESS RESTRICTED
                </h1>
                <p className="font-mono text-gray-600">
                  This section is only available to organization administrators
                  or Mediar staff.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-7xl mx-auto">
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
                  <h2 className="font-mono font-bold text-lg">
                    CURRENT ORGANIZATION
                  </h2>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="font-mono text-xs text-gray-600 mb-1">
                        NAME
                      </p>
                      <p className="font-mono font-bold">{selectedOrg.name}</p>
                    </div>
                    <div>
                      <p className="font-mono text-xs text-gray-600 mb-1">ID</p>
                      <p className="font-mono text-xs break-all">
                        {selectedOrg.clerk_organization_id || selectedOrg.id}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-xs text-gray-600 mb-1">
                        YOUR ROLE
                      </p>
                      <p className="font-mono font-bold flex items-center gap-1">
                        {membership?.role === 'org:owner' && (
                          <Crown className="w-4 h-4" />
                        )}
                        {membership?.role?.replace('org:', '').toUpperCase()}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-xs text-gray-600 mb-1">
                        MEMBERS
                      </p>
                      <p className="font-mono font-bold">
                        {selectedOrg.member_count || 0}
                      </p>
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
                  {[
                    'overview',
                    'members',
                    'invitations',
                    ...(isGlobalAdmin ? ['machines'] : []),
                  ].map(tab => (
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
                        <p className="font-mono text-2xl font-bold">
                          {orgMembers.length}
                        </p>
                        <p className="font-mono text-xs text-gray-600">
                          ACTIVE MEMBERS
                        </p>
                      </div>
                      <div className="border-2 border-black p-4">
                        <Mail className="w-6 h-6 mb-2" />
                        <p className="font-mono text-2xl font-bold">
                          {orgInvitations.length}
                        </p>
                        <p className="font-mono text-xs text-gray-600">
                          PENDING INVITES
                        </p>
                      </div>
                      <div className="border-2 border-black p-4">
                        <Building2 className="w-6 h-6 mb-2" />
                        <p className="font-mono text-2xl font-bold">
                          {isGlobalAdmin
                            ? allOrganizations.length
                            : userMemberships?.data?.length || 1}
                        </p>
                        <p className="font-mono text-xs text-gray-600">
                          ORGANIZATIONS
                        </p>
                      </div>
                    </div>

                    {/* User's Organizations - Show for non-global admin */}
                    {!isGlobalAdmin &&
                      userMemberships?.data &&
                      userMemberships.data.length > 1 && (
                        <div className="border-2 border-black">
                          <div className="bg-gray-50 p-4 border-b-2 border-black">
                            <h3 className="font-mono font-bold">
                              YOUR ORGANIZATIONS
                            </h3>
                          </div>
                          <div className="divide-y divide-gray-200">
                            {userMemberships.data.map(org => (
                              <div
                                key={org.organization.id}
                                className="p-4 flex items-center justify-between"
                              >
                                <div>
                                  <p className="font-mono font-bold">
                                    {org.organization.name}
                                  </p>
                                  <p className="font-mono text-xs text-gray-600">
                                    Role:{' '}
                                    {org.role
                                      ?.replace('org:', '')
                                      .toUpperCase()}
                                  </p>
                                </div>
                                {org.organization.id !== organization?.id && (
                                  <button
                                    onClick={() =>
                                      setActive?.({
                                        organization: org.organization.id,
                                      })
                                    }
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
                      <h3 className="font-mono font-bold">
                        ORGANIZATION MEMBERS
                      </h3>
                      {isGlobalAdmin && (
                        <button
                          onClick={() =>
                            fetchOrgMembers(
                              selectedOrg?.clerk_organization_id ||
                                selectedOrg?.id
                            )
                          }
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
                        {orgMembers.map(member => (
                          <div
                            key={member.id}
                            className="p-4 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-black text-white rounded-full flex items-center justify-center font-mono font-bold">
                                {member.firstName?.[0]?.toUpperCase() ||
                                  member.email?.[0]?.toUpperCase() ||
                                  '?'}
                              </div>
                              <div>
                                <p className="font-mono font-bold">
                                  {member.firstName} {member.lastName}
                                  {member.userId === user?.id && (
                                    <span className="ml-2 text-xs text-gray-600">
                                      (YOU)
                                    </span>
                                  )}
                                </p>
                                <p className="font-mono text-xs text-gray-600">
                                  {member.email}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span
                                className={`font-mono text-xs px-2 py-1 border ${
                                  member.role === 'org:owner'
                                    ? 'border-black bg-black text-white'
                                    : member.role === 'org:admin'
                                      ? 'border-black bg-gray-100'
                                      : 'border-gray-400'
                                }`}
                              >
                                {member.role === 'org:owner' && (
                                  <Crown className="w-3 h-3 inline mr-1" />
                                )}
                                {member.role.replace('org:', '').toUpperCase()}
                              </span>
                              {isGlobalAdmin &&
                                member.userId !== user?.id &&
                                member.role !== 'org:owner' && (
                                  <button
                                    onClick={async () => {
                                      if (
                                        confirm(
                                          `Remove ${member.email} from organization?`
                                        )
                                      ) {
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
                        <h3 className="font-mono font-bold mb-4">
                          INVITE NEW MEMBER
                        </h3>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
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
                        <h3 className="font-mono font-bold">
                          PENDING INVITATIONS
                        </h3>
                        {isGlobalAdmin && (
                          <button
                            onClick={() =>
                              fetchOrgInvitations(
                                selectedOrg?.clerk_organization_id ||
                                  selectedOrg?.id
                              )
                            }
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
                          {orgInvitations.map(invitation => (
                            <div
                              key={invitation.id}
                              className="p-4 flex items-center justify-between"
                            >
                              <div>
                                <p className="font-mono font-bold">
                                  {invitation.email}
                                </p>
                                <p className="font-mono text-xs text-gray-600 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Invited{' '}
                                  {new Date(
                                    invitation.createdAt
                                  ).toLocaleDateString()}
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
                                        await handleRevokeInvitation(
                                          invitation.id
                                        );
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

                {activeTab === 'machines' && isGlobalAdmin && (
                  <div className="space-y-6">
                    {/* Add Machine Button */}
                    <div className="flex justify-between items-center">
                      <h3 className="font-mono font-bold text-xl flex items-center gap-2">
                        <Server className="w-6 h-6" />
                        REMOTE MACHINES
                      </h3>
                      <button
                        onClick={() => setShowAddMachine(true)}
                        className="px-4 py-2 bg-black text-white font-mono font-bold hover:bg-gray-800 flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        ADD MACHINE
                      </button>
                    </div>

                    {/* Machines Table */}
                    <div className="border-2 border-black">
                      <div className="bg-gray-50 p-4 border-b-2 border-black flex items-center justify-between">
                        <h3 className="font-mono font-bold">
                          MACHINE REGISTRY
                        </h3>
                        <button
                          onClick={fetchMachines}
                          className="px-2 py-1 font-mono text-xs border border-black hover:bg-black hover:text-white flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          REFRESH
                        </button>
                      </div>
                      {loadingMachines ? (
                        <div className="overflow-x-auto w-full border-t border-gray-200">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '180px' }}
                                >
                                  NAME
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '100px' }}
                                >
                                  STATUS
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '120px' }}
                                >
                                  HEALTH
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '120px' }}
                                >
                                  IP ADDRESS
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '140px' }}
                                >
                                  AZURE ID
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '140px' }}
                                >
                                  ORGANIZATIONS
                                </th>
                                <th
                                  className="px-3 py-3 text-right font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '100px' }}
                                >
                                  ACTIONS
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {[1, 2, 3].map(i => (
                                <tr key={i} className="animate-pulse">
                                  <td className="px-3 py-3">
                                    <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                                    <div className="h-3 bg-gray-100 rounded w-48"></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="h-6 bg-gray-200 rounded w-20"></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
                                    <div className="h-3 bg-gray-100 rounded w-32"></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="h-3 bg-gray-200 rounded w-28"></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="h-3 bg-gray-200 rounded w-24"></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="h-6 bg-gray-200 rounded w-20"></div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex items-center justify-end gap-1">
                                      <div className="h-8 w-8 bg-gray-200 rounded"></div>
                                      <div className="h-8 w-8 bg-gray-200 rounded"></div>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="overflow-x-auto w-full border-t border-gray-200">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '180px' }}
                                >
                                  NAME
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '100px' }}
                                >
                                  STATUS
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '120px' }}
                                >
                                  HEALTH
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '120px' }}
                                >
                                  IP ADDRESS
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '140px' }}
                                >
                                  AZURE ID
                                </th>
                                <th
                                  className="px-3 py-3 text-left font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '140px' }}
                                >
                                  ORGANIZATIONS
                                </th>
                                <th
                                  className="px-3 py-3 text-right font-mono text-xs text-gray-600 whitespace-nowrap"
                                  style={{ minWidth: '100px' }}
                                >
                                  ACTIONS
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {machines.map(machine => (
                                <tr
                                  key={machine.id}
                                  className="hover:bg-gray-50"
                                >
                                  <td className="px-3 py-3">
                                    <div>
                                      {editingMachine === machine.id ? (
                                        <input
                                          type="text"
                                          value={editedMachineData.name}
                                          onChange={e =>
                                            setEditedMachineData({
                                              ...editedMachineData,
                                              name: e.target.value,
                                            })
                                          }
                                          className="w-full px-2 py-1 font-mono font-bold text-sm border border-black focus:outline-none focus:ring-1 focus:ring-black"
                                          placeholder="Machine name"
                                        />
                                      ) : (
                                        <button
                                          onClick={() =>
                                            copyToClipboard(
                                              machine.name,
                                              'Machine name'
                                            )
                                          }
                                          className="font-mono font-bold text-sm hover:bg-gray-100 px-2 py-1 -mx-2 -my-1 rounded text-left"
                                          title={`${machine.name} (click to copy)`}
                                        >
                                          {machine.name}
                                        </button>
                                      )}
                                      {(machine.description ||
                                        editingMachine === machine.id) && (
                                        <p
                                          className="font-mono text-xs text-gray-600 mt-1"
                                          title={machine.description || ''}
                                        >
                                          {editingMachine === machine.id ? (
                                            <input
                                              type="text"
                                              value={
                                                editedMachineData.description
                                              }
                                              onChange={e =>
                                                setEditedMachineData({
                                                  ...editedMachineData,
                                                  description: e.target.value,
                                                })
                                              }
                                              className="w-full px-2 py-1 font-mono text-xs border border-black focus:outline-none focus:ring-1 focus:ring-black"
                                              placeholder="Description"
                                            />
                                          ) : (
                                            <span className="line-clamp-2">
                                              {machine.description}
                                            </span>
                                          )}
                                        </p>
                                      )}
                                      {editingMachine !== machine.id && (
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className="font-mono text-xs text-gray-600">
                                            Priority: {machine.priority}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    {editingMachine === machine.id ? (
                                      <select
                                        value={editedMachineData.status}
                                        onChange={e =>
                                          setEditedMachineData({
                                            ...editedMachineData,
                                            status: e.target.value,
                                          })
                                        }
                                        className="px-2 py-1 font-mono text-xs border border-black focus:outline-none focus:ring-1 focus:ring-black"
                                      >
                                        <option value="active">ACTIVE</option>
                                        <option value="inactive">
                                          INACTIVE
                                        </option>
                                        <option value="maintenance">
                                          MAINTENANCE
                                        </option>
                                        <option value="failed">FAILED</option>
                                      </select>
                                    ) : (
                                      <span
                                        className={`font-mono text-xs px-2 py-1 whitespace-nowrap ${
                                          machine.status === 'active'
                                            ? 'bg-black text-white'
                                            : machine.status === 'maintenance'
                                              ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                                              : machine.status === 'failed'
                                                ? 'bg-black text-white font-bold'
                                                : 'bg-gray-200 text-gray-800'
                                        }`}
                                      >
                                        {machine.status?.toUpperCase()}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="space-y-1">
                                      {machine.status === 'active' ? (
                                        <>
                                          <div className="flex items-center gap-1">
                                            <Activity
                                              className={`w-3 h-3 ${
                                                machine.health_status ===
                                                'healthy'
                                                  ? 'text-black'
                                                  : machine.health_status ===
                                                      'unhealthy'
                                                    ? 'text-gray-600'
                                                    : 'text-gray-400'
                                              } ${machine.health_status === 'healthy' ? 'animate-pulse' : ''}`}
                                            />
                                            <span className="font-mono text-xs">
                                              {machine.health_status?.toUpperCase() ||
                                                'UNKNOWN'}
                                            </span>
                                          </div>
                                        </>
                                      ) : (
                                        <div className="flex items-center gap-1">
                                          <Activity className="w-3 h-3 text-gray-400" />
                                          <span className="font-mono text-xs text-gray-400">
                                            N/A
                                          </span>
                                        </div>
                                      )}
                                      {machine.status === 'active' && (
                                        <div className="font-mono text-xs text-gray-600">
                                          {(() => {
                                            const totalChecks =
                                              (machine as any).total_checks ||
                                              0;
                                            const successfulChecks =
                                              (machine as any)
                                                .successful_checks || 0;
                                            const lastCheck =
                                              machine.last_health_check;

                                            if (totalChecks === 0) {
                                              return <span>No checks</span>;
                                            }

                                            let uptimePercent =
                                              (successfulChecks / totalChecks) *
                                              100;

                                            if (lastCheck) {
                                              const hoursSinceCheck =
                                                (Date.now() -
                                                  new Date(
                                                    lastCheck
                                                  ).getTime()) /
                                                (1000 * 60 * 60);
                                              if (hoursSinceCheck > 24) {
                                                const daysSinceCheck =
                                                  hoursSinceCheck / 24;
                                                const stalePenalty = Math.min(
                                                  daysSinceCheck * 10,
                                                  uptimePercent
                                                );
                                                uptimePercent = Math.max(
                                                  0,
                                                  uptimePercent - stalePenalty
                                                );
                                              }
                                            }

                                            const uptimeStr =
                                              uptimePercent.toFixed(1);
                                            const title =
                                              lastCheck &&
                                              Date.now() -
                                                new Date(lastCheck).getTime() >
                                                86400000
                                                ? `${successfulChecks}/${totalChecks} checks (stale)`
                                                : `${successfulChecks}/${totalChecks} checks`;

                                            return (
                                              <span title={title}>
                                                {uptimeStr}% •{' '}
                                                {formatTimeAgo(
                                                  machine.last_health_check
                                                )}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="font-mono text-xs">
                                      {(() => {
                                        try {
                                          const endpoint =
                                            machine.endpoints?.mcp ||
                                            machine.mcp_endpoint ||
                                            '';
                                          const url = new URL(endpoint);
                                          return url.hostname;
                                        } catch {
                                          return '-';
                                        }
                                      })()}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="font-mono text-xs">
                                      {machine.azure_resource_id ? (
                                        <a
                                          href={`https://portal.azure.com/#resource${machine.azure_resource_id}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:bg-gray-100 px-2 py-1 -mx-2 -my-1 rounded text-left truncate max-w-[140px] inline-block underline hover:no-underline"
                                          title={`Open ${machine.azure_resource_id} in Azure Portal`}
                                        >
                                          {machine.azure_resource_id
                                            .split('/')
                                            .pop() || machine.azure_resource_id}
                                        </a>
                                      ) : (
                                        '-'
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex items-center gap-1">
                                      {(machineIsGlobal[machine.id] ??
                                      false) ? (
                                        <span className="font-mono text-xs px-2 py-1 bg-black text-white whitespace-nowrap">
                                          ALL ORGS
                                        </span>
                                      ) : (
                                        <span className="font-mono text-xs px-2 py-1 border border-black whitespace-nowrap">
                                          {
                                            (
                                              machineOrgAssignments[
                                                machine.id
                                              ] || []
                                            ).length
                                          }{' '}
                                          ORG
                                          {(
                                            machineOrgAssignments[machine.id] ||
                                            []
                                          ).length !== 1
                                            ? 'S'
                                            : ''}
                                        </span>
                                      )}
                                      <button
                                        onClick={() =>
                                          handleEditMachineOrgs(machine.id)
                                        }
                                        className="p-1 hover:bg-black hover:text-white border border-black text-xs"
                                        title="Manage organization access"
                                      >
                                        <Building2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex items-center justify-end gap-1">
                                      {editingMachine === machine.id ? (
                                        <>
                                          <div className="flex items-center gap-1 mr-2">
                                            <span className="font-mono text-xs text-gray-600">
                                              P:
                                            </span>
                                            <input
                                              type="number"
                                              min="1"
                                              max="10"
                                              value={editedMachineData.priority}
                                              onChange={e =>
                                                setEditedMachineData({
                                                  ...editedMachineData,
                                                  priority: parseInt(
                                                    e.target.value
                                                  ),
                                                })
                                              }
                                              className="w-12 px-2 py-1 font-mono text-xs border border-black focus:outline-none focus:ring-1 focus:ring-black"
                                            />
                                          </div>
                                          <button
                                            onClick={() =>
                                              handleSaveMachine(machine.id)
                                            }
                                            className="p-1 hover:bg-black hover:text-white border border-black"
                                            title="Save changes"
                                          >
                                            <Check className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => {
                                              setEditingMachine(null);
                                              setEditedMachineData({});
                                            }}
                                            className="p-1 hover:bg-gray-100 border border-black"
                                            title="Cancel"
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                        </>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() =>
                                              handleEditMachine(machine)
                                            }
                                            className="p-1 hover:bg-black hover:text-white border border-black"
                                            title="Edit machine"
                                          >
                                            <Edit2 className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() =>
                                              handleDeleteMachine(
                                                machine.id,
                                                machine.name
                                              )
                                            }
                                            className="p-1 hover:bg-red-600 hover:text-white hover:border-red-600 border border-black"
                                            title="Delete machine"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {machines.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={7}
                                    className="px-4 py-8 text-center text-gray-500 font-mono"
                                  >
                                    No machines registered
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Machine Stats */}
                    {machines.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="border-2 border-black p-4">
                          <Cpu className="w-6 h-6 mb-2" />
                          <p className="font-mono text-2xl font-bold">
                            {machines.length}
                          </p>
                          <p className="font-mono text-xs text-gray-600">
                            TOTAL MACHINES
                          </p>
                        </div>
                        <div className="border-2 border-black p-4">
                          <Activity className="w-6 h-6 mb-2" />
                          <p className="font-mono text-2xl font-bold">
                            {machines.filter(m => m.status === 'active').length}
                          </p>
                          <p className="font-mono text-xs text-gray-600">
                            ACTIVE
                          </p>
                        </div>
                        <div className="border-2 border-black p-4">
                          <Server className="w-6 h-6 mb-2" />
                          <p className="font-mono text-2xl font-bold">
                            {machines.reduce(
                              (sum, m) => sum + m.max_concurrent_executions,
                              0
                            )}
                          </p>
                          <p className="font-mono text-xs text-gray-600">
                            TOTAL CAPACITY
                          </p>
                        </div>
                        <div className="border-2 border-black p-4">
                          <RefreshCw className="w-6 h-6 mb-2" />
                          <p className="font-mono text-2xl font-bold">
                            {machines.reduce(
                              (sum, m) =>
                                sum + (m.load_info?.current_executions || 0),
                              0
                            )}
                          </p>
                          <p className="font-mono text-xs text-gray-600">
                            RUNNING NOW
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="border-2 border-black p-8 text-center">
              <Building2 className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="font-mono text-gray-600 mb-4">
                No organization selected
              </p>
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
            <div className="fixed inset-0 bg-white bg-opacity-90 flex items-center justify-center p-4 z-50">
              <div className="bg-white border-2 border-black max-w-lg w-full">
                <div className="p-4 border-b-2 border-black flex items-center justify-between">
                  <h2 className="font-mono font-bold">
                    CREATE NEW ORGANIZATION
                  </h2>
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
                        rootBox: 'bg-white',
                        card: 'border-0 shadow-none bg-white',
                        headerTitle: 'font-mono font-bold text-black',
                        headerSubtitle: 'font-mono text-gray-600',
                        formButtonPrimary:
                          'bg-black hover:bg-gray-800 text-white font-mono',
                        formFieldInput: 'border-2 border-black font-mono',
                        formFieldLabel: 'font-mono text-black',
                        identityPreview: 'border-2 border-black',
                        identityPreviewText: 'font-mono',
                        footer: 'bg-white',
                        footerActionLink: 'text-black hover:underline',
                      },
                      layout: {
                        socialButtonsPlacement: 'bottom',
                        socialButtonsVariant: 'blockButton',
                      },
                      variables: {
                        colorPrimary: '#000000',
                        colorBackground: '#FFFFFF',
                        colorText: '#000000',
                        colorTextSecondary: '#666666',
                        colorInputBackground: '#FFFFFF',
                        colorInputText: '#000000',
                        borderRadius: '0px',
                        fontFamily: 'monospace',
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Edit Machine Organizations Modal */}
          {editingMachineOrgs !== null && isGlobalAdmin && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-white border-2 border-black max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b-2 border-black flex items-center justify-between sticky top-0 bg-white">
                  <h2 className="font-mono font-bold flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    MANAGE ORGANIZATION ACCESS
                  </h2>
                  <button
                    onClick={() => {
                      setEditingMachineOrgs(null);
                      setOrgSearchQuery('');
                    }}
                    className="p-1 hover:bg-gray-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <p className="font-mono text-sm mb-4">
                      Machine:{' '}
                      <span className="font-bold">
                        {machines.find(m => m.id === editingMachineOrgs)?.name}
                      </span>
                    </p>
                  </div>

                  <div className="border-2 border-black p-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={machineIsGlobal[editingMachineOrgs] ?? false}
                        onChange={() =>
                          toggleMachineIsGlobal(editingMachineOrgs)
                        }
                        className="w-4 h-4 border-2 border-black focus:ring-2 focus:ring-black"
                      />
                      <span className="font-mono font-bold">
                        AVAILABLE TO ALL ORGANIZATIONS
                      </span>
                    </label>
                    <p className="font-mono text-xs text-gray-600 mt-2 ml-6">
                      When enabled, this machine is available to all
                      organizations. When disabled, only selected organizations
                      can use this machine.
                    </p>
                  </div>

                  {!(machineIsGlobal[editingMachineOrgs] ?? false) && (
                    <div className="border-2 border-black">
                      <div className="bg-gray-50 p-4 border-b-2 border-black">
                        <h3 className="font-mono font-bold">
                          SELECT ORGANIZATIONS
                        </h3>
                        <p className="font-mono text-xs text-gray-600 mt-1">
                          Only selected organizations will have access to this
                          machine
                        </p>

                        {/* Search bar */}
                        <div className="mt-3 relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Search organizations..."
                            value={orgSearchQuery}
                            onChange={e => setOrgSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                          />
                        </div>
                      </div>
                      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                        {allOrganizations.length === 0 ? (
                          <div className="p-8 text-center text-gray-500 font-mono">
                            No organizations available
                          </div>
                        ) : (
                          (() => {
                            // Filter organizations by search query
                            const filteredOrgs = allOrganizations.filter(org =>
                              org.name
                                .toLowerCase()
                                .includes(orgSearchQuery.toLowerCase())
                            );

                            // Sort: selected organizations first, then alphabetically
                            const sortedOrgs = filteredOrgs.sort((a, b) => {
                              const aSelected = (
                                machineOrgAssignments[editingMachineOrgs] || []
                              ).includes(a.clerk_organization_id || a.id);
                              const bSelected = (
                                machineOrgAssignments[editingMachineOrgs] || []
                              ).includes(b.clerk_organization_id || b.id);

                              // Selected ones come first
                              if (aSelected && !bSelected) return -1;
                              if (!aSelected && bSelected) return 1;

                              // Within same group, sort alphabetically
                              return a.name.localeCompare(b.name);
                            });

                            if (filteredOrgs.length === 0) {
                              return (
                                <div className="p-8 text-center text-gray-500 font-mono">
                                  No organizations match your search
                                </div>
                              );
                            }

                            return sortedOrgs.map(org => (
                              <div
                                key={org.clerk_organization_id || org.id}
                                className="p-4 flex items-center justify-between hover:bg-gray-50"
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={(
                                      machineOrgAssignments[
                                        editingMachineOrgs
                                      ] || []
                                    ).includes(
                                      org.clerk_organization_id || org.id
                                    )}
                                    onChange={() =>
                                      toggleMachineOrgAssignment(
                                        editingMachineOrgs,
                                        org.clerk_organization_id || org.id
                                      )
                                    }
                                    className="w-4 h-4 border-2 border-black focus:ring-2 focus:ring-black"
                                  />
                                  <div>
                                    <p className="font-mono font-bold">
                                      {org.name}
                                    </p>
                                    <p className="font-mono text-xs text-gray-600">
                                      {org.member_count || 0} member
                                      {org.member_count !== 1 ? 's' : ''}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => {
                        setEditingMachineOrgs(null);
                        setOrgSearchQuery('');
                      }}
                      className="px-4 py-2 font-mono font-bold border-2 border-black hover:bg-gray-100"
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={() => handleSaveMachineOrgs(editingMachineOrgs)}
                      className="px-4 py-2 font-mono font-bold bg-black text-white hover:bg-gray-800"
                    >
                      SAVE CHANGES
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Add Machine Modal */}
          {showAddMachine && isGlobalAdmin && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-white border-2 border-black max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-4 border-b-2 border-black flex items-center justify-between sticky top-0 bg-white">
                  <h2 className="font-mono font-bold flex items-center gap-2">
                    <Server className="w-5 h-5" />
                    ADD NEW MACHINE
                  </h2>
                  <button
                    onClick={() => {
                      setShowAddMachine(false);
                      setNewMachine({
                        name: '',
                        description: '',
                        mcp_endpoint: '',
                        management_endpoint: '',
                        health_endpoint: '',
                        machine_type: 'windows_vm',
                        max_concurrent_executions: 1,
                        priority: 5,
                        region: '',
                        tags: [],
                        azure_resource_id: '',
                      });
                    }}
                    className="p-1 hover:bg-gray-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block font-mono text-xs text-gray-600 mb-1">
                      MACHINE NAME *
                    </label>
                    <input
                      type="text"
                      value={newMachine.name}
                      onChange={e =>
                        setNewMachine({ ...newMachine, name: e.target.value })
                      }
                      placeholder="e.g., vm-prod-01"
                      className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      required
                    />
                  </div>

                  <div>
                    <label className="block font-mono text-xs text-gray-600 mb-1">
                      DESCRIPTION
                    </label>
                    <input
                      type="text"
                      value={newMachine.description}
                      onChange={e =>
                        setNewMachine({
                          ...newMachine,
                          description: e.target.value,
                        })
                      }
                      placeholder="Brief description of this machine"
                      className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        MCP ENDPOINT *
                      </label>
                      <input
                        type="text"
                        value={newMachine.mcp_endpoint}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            mcp_endpoint: e.target.value,
                          })
                        }
                        placeholder="https://mcp.example.com"
                        className="w-full px-3 py-2 font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        MANAGEMENT ENDPOINT *
                      </label>
                      <input
                        type="text"
                        value={newMachine.management_endpoint}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            management_endpoint: e.target.value,
                          })
                        }
                        placeholder="https://manage.example.com"
                        className="w-full px-3 py-2 font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-xs text-gray-600 mb-1">
                      HEALTH ENDPOINT
                    </label>
                    <input
                      type="text"
                      value={newMachine.health_endpoint}
                      onChange={e =>
                        setNewMachine({
                          ...newMachine,
                          health_endpoint: e.target.value,
                        })
                      }
                      placeholder="Leave empty to use management endpoint + /health"
                      className="w-full px-3 py-2 font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        MACHINE TYPE
                      </label>
                      <select
                        value={newMachine.machine_type}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            machine_type: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      >
                        <option value="windows_vm">WINDOWS VM</option>
                        <option value="linux_vm">LINUX VM</option>
                        <option value="macos_vm">MACOS VM</option>
                        <option value="container">CONTAINER</option>
                        <option value="physical">PHYSICAL</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        MAX CONCURRENT
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={newMachine.max_concurrent_executions}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            max_concurrent_executions: parseInt(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        PRIORITY (1-10)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={newMachine.priority}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            priority: parseInt(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        REGION
                      </label>
                      <input
                        type="text"
                        value={newMachine.region}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            region: e.target.value,
                          })
                        }
                        placeholder="e.g., us-west-2"
                        className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>

                    <div>
                      <label className="block font-mono text-xs text-gray-600 mb-1">
                        AZURE RESOURCE ID
                      </label>
                      <input
                        type="text"
                        value={newMachine.azure_resource_id}
                        onChange={e =>
                          setNewMachine({
                            ...newMachine,
                            azure_resource_id: e.target.value,
                          })
                        }
                        placeholder="e.g., /subscriptions/.../vm-name"
                        className="w-full px-3 py-2 font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-xs text-gray-600 mb-1">
                      TAGS (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={newMachine.tags.join(', ')}
                      onChange={e =>
                        setNewMachine({
                          ...newMachine,
                          tags: e.target.value
                            .split(',')
                            .map(tag => tag.trim())
                            .filter(tag => tag.length > 0),
                        })
                      }
                      placeholder="e.g., production, chrome, high-memory"
                      className="w-full px-3 py-2 font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => {
                        setShowAddMachine(false);
                        setNewMachine({
                          name: '',
                          description: '',
                          mcp_endpoint: '',
                          management_endpoint: '',
                          health_endpoint: '',
                          machine_type: 'windows_vm',
                          max_concurrent_executions: 1,
                          priority: 5,
                          region: '',
                          tags: [],
                          azure_resource_id: '',
                        });
                      }}
                      className="px-4 py-2 font-mono font-bold border-2 border-black hover:bg-gray-100"
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={handleAddMachine}
                      disabled={
                        !newMachine.name ||
                        !newMachine.mcp_endpoint ||
                        !newMachine.management_endpoint
                      }
                      className={`px-4 py-2 font-mono font-bold ${
                        !newMachine.name ||
                        !newMachine.mcp_endpoint ||
                        !newMachine.management_endpoint
                          ? 'bg-gray-200 text-gray-500 border-2 border-gray-400'
                          : 'bg-black text-white hover:bg-gray-800'
                      }`}
                    >
                      ADD MACHINE
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="p-4">
            <div className="max-w-7xl mx-auto">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          </div>
        </DashboardLayout>
      }
    >
      <AdminPageContent />
    </Suspense>
  );
}
