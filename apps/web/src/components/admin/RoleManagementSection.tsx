'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useOrganization } from '@clerk/nextjs';
import {
    AlertCircle,
    Crown,
    RefreshCw,
    Shield,
    Trash2,
    User,
    Users,
    UserPlus,
    Mail,
    XCircle
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface OrganizationUser {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  joinedAt: string;
}

interface OrganizationInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: number;
}

interface RoleManagementSectionProps {
  isOwner: boolean;
  isAdmin: boolean;
  currentUserId?: string;
}

export default function RoleManagementSection({ isOwner, isAdmin, currentUserId }: RoleManagementSectionProps) {
  const [orgUsers, setOrgUsers] = useState<OrganizationUser[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingUsers, setProcessingUsers] = useState<Set<string>>(new Set());
  const [processingInvitations, setProcessingInvitations] = useState<Set<string>>(new Set());

  // Invite state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('org:member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { organization } = useOrganization();

  // Fetch organization users from the organization-members API
  const fetchOrganizationUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!organization?.id) {
        throw new Error('No organization selected');
      }

      // Fetch both members and invitations in parallel
      const [membersResponse, invitationsResponse] = await Promise.all([
        fetch(`/api/organization-members?orgId=${organization.id}`),
        fetch(`/api/organization-invitations?orgId=${organization.id}`)
      ]);

      if (!membersResponse.ok) {
        throw new Error(`Failed to fetch organization members: ${membersResponse.statusText}`);
      }

      const membersData = await membersResponse.json();

      // Map the API response to our interface
      const users = (membersData.members || []).map((member: any) => ({
        userId: member.userId,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
        joinedAt: new Date().toISOString(), // API doesn't return this, use current time as fallback
      }));

      setOrgUsers(users);

      // Fetch invitations (don't fail if this errors)
      if (invitationsResponse.ok) {
        const invitationsData = await invitationsResponse.json();
        setPendingInvitations(invitationsData.invitations || []);
      } else {
        console.warn('Failed to fetch invitations, continuing without them');
        setPendingInvitations([]);
      }
    } catch (err) {
      console.error('Error fetching organization members:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch organization members');
      setOrgUsers([]);
      setPendingInvitations([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle invite submission
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    setInviteMessage(null);

    try {
      const response = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invitation');
      }

      setInviteMessage({ type: 'success', text: `✓ Invitation sent to ${inviteEmail}` });
      setInviteEmail('');
      setInviteRole('org:member');

      // Refresh the members list after a short delay
      setTimeout(() => {
        setIsInviteOpen(false);
        setInviteMessage(null);
        fetchOrganizationUsers();
      }, 2000);
    } catch (err) {
      setInviteMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to send invitation'
      });
    } finally {
      setInviteLoading(false);
    }
  };

  // Change user role
  const changeUserRole = async (userId: string, newRole: string) => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    
    try {
      const response = await fetch('/api/manage-user-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIdToUpdate: userId, newRole })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update user role: ${response.statusText}`);
      }
      
      // Update local state
      setOrgUsers(prev => 
        prev.map(user => 
          user.userId === userId ? { ...user, role: newRole } : user
        )
      );
    } catch (err) {
      console.error('Error updating user role:', err);
      setError(err instanceof Error ? err.message : 'Failed to update user role');
    } finally {
      setProcessingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Remove user from organization
  const removeUser = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this user from the organization?')) {
      return;
    }

    setProcessingUsers(prev => new Set(prev).add(userId));

    try {
      const response = await fetch(`/api/users/${userId}/organization`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`Failed to remove user: ${response.statusText}`);
      }

      // Remove from local state
      setOrgUsers(prev => prev.filter(user => user.userId !== userId));
    } catch (err) {
      console.error('Error removing user:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    } finally {
      setProcessingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Revoke invitation
  const revokeInvitation = async (invitationId: string, email: string) => {
    if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) {
      return;
    }

    setProcessingInvitations(prev => new Set(prev).add(invitationId));

    try {
      const response = await fetch('/api/organization-invitations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId })
      });

      if (!response.ok) {
        throw new Error(`Failed to revoke invitation: ${response.statusText}`);
      }

      // Remove from local state
      setPendingInvitations(prev => prev.filter(invite => invite.id !== invitationId));
    } catch (err) {
      console.error('Error revoking invitation:', err);
      setError(err instanceof Error ? err.message : 'Failed to revoke invitation');
    } finally {
      setProcessingInvitations(prev => {
        const newSet = new Set(prev);
        newSet.delete(invitationId);
        return newSet;
      });
    }
  };

  // Get role icon
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'org:owner':
        return <Crown className="w-4 h-4 text-black" />;
      case 'org:admin':
        return <Shield className="w-4 h-4 text-black" />;
      case 'org:member':
        return <User className="w-4 h-4 text-black" />;
      default:
        return <User className="w-4 h-4 text-black" />;
    }
  };

  // Get role badge color
  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'org:owner':
        return 'bg-black text-white border-black';
      case 'org:admin':
        return 'bg-white text-black border-black';
      case 'org:member':
        return 'bg-white text-black border-black';
      default:
        return 'bg-white text-black border-black';
    }
  };

  // Load data on mount and when organization changes
  useEffect(() => {
    if (isAdmin && organization?.id) {
      fetchOrganizationUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, organization?.id]); // Intentionally omit fetchOrganizationUsers to prevent infinite loop

  // Don't render if not admin or owner
  if (!isAdmin) {
    return null;
  }

  return (
    <Card className="border-black-outline">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-black flex items-center gap-2">
            <Users className="w-5 h-5" />
            Organization Members
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsInviteOpen(true)}
              className="border-black-outline hover:bg-black hover:text-white"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              INVITE
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchOrganizationUsers}
              disabled={loading}
              className="border-black-outline hover:bg-black hover:text-white"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert className="mb-4 border-red-200 bg-red-50">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-700">{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading organization members...</span>
          </div>
        ) : orgUsers.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-black mb-2">No Members Found</h3>
            <p className="text-gray-600">
              No organization members found or API not yet implemented.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {orgUsers.map((user) => (
              <div 
                key={user.userId} 
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    {getRoleIcon(user.role)}
                  </div>
                  <div>
                    <div className="font-medium text-black">
                      {user.firstName || user.lastName 
                        ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                        : user.email
                      }
                      {user.userId === currentUserId && (
                        <span className="text-sm text-gray-500 ml-2">(You)</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600">{user.email}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className={getRoleBadgeColor(user.role)}>
                        {user.role.replace('org:', '').toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {new Date(user.joinedAt).toLocaleDateString()}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {/* Role Change Dropdown - Only owners can change roles */}
                  {user.userId !== currentUserId && isOwner && (
                    <Select
                      value={user.role}
                      onValueChange={(newRole) => changeUserRole(user.userId, newRole)}
                      disabled={processingUsers.has(user.userId)}
                    >
                      <SelectTrigger className="w-32 border-black-outline">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="org:member">Member</SelectItem>
                        <SelectItem value="org:admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  {/* Remove User Button - Only owners can remove users */}
                  {user.userId !== currentUserId && isOwner && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeUser(user.userId)}
                      disabled={processingUsers.has(user.userId)}
                      className="border-red-200 text-red-700 hover:bg-red-50"
                    >
                      {processingUsers.has(user.userId) ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pending Invitations Section */}
        {!loading && pendingInvitations.length > 0 && (
          <div className="mt-8 pt-6 border-t-2 border-black">
            <h3 className="font-mono font-bold text-sm uppercase mb-4 flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Pending Invitations ({pendingInvitations.length})
            </h3>
            <div className="space-y-3">
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                      <Mail className="w-4 h-4 text-yellow-800" />
                    </div>
                    <div>
                      <div className="font-medium text-black">{invitation.email}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border border-yellow-300">
                          PENDING
                        </Badge>
                        <Badge variant="outline" className={getRoleBadgeColor(invitation.role)}>
                          {invitation.role.replace('org:', '').toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {new Date(invitation.createdAt).toLocaleDateString()}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Revoke Button - Only owners can revoke */}
                  {isOwner && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => revokeInvitation(invitation.id, invitation.email)}
                      disabled={processingInvitations.has(invitation.id)}
                      className="border-red-200 text-red-700 hover:bg-red-50"
                    >
                      {processingInvitations.has(invitation.id) ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 mr-1" />
                          REVOKE
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Invite Dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="border-2 border-black">
          <DialogHeader>
            <DialogTitle className="font-mono font-bold text-xl">INVITE TEAM MEMBER</DialogTitle>
            <DialogDescription className="font-mono text-sm">
              Send an invitation to join {organization?.name || 'your organization'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInvite} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="font-mono text-xs text-gray-600 uppercase block mb-2">
                Email Address
              </label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                className="border-2 border-black focus:outline-none focus:ring-2 focus:ring-black font-mono"
                required
              />
            </div>

            <div>
              <label htmlFor="invite-role" className="font-mono text-xs text-gray-600 uppercase block mb-2">
                Role
              </label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger id="invite-role" className="border-2 border-black font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="org:member" className="font-mono">Member</SelectItem>
                  <SelectItem value="org:admin" className="font-mono">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {inviteMessage && (
              <div className={`p-3 border-2 font-mono ${
                inviteMessage.type === 'success'
                  ? 'border-black bg-white'
                  : 'border-black bg-black text-white font-bold'
              }`}>
                {inviteMessage.text}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsInviteOpen(false);
                  setInviteEmail('');
                  setInviteRole('org:member');
                  setInviteMessage(null);
                }}
                className="border-2 border-black hover:bg-black hover:text-white font-mono font-bold"
              >
                CANCEL
              </Button>
              <Button
                type="submit"
                disabled={inviteLoading}
                className={`font-mono font-bold ${
                  inviteLoading
                    ? 'bg-gray-200 text-gray-500 border-2 border-gray-400'
                    : 'bg-black text-white hover:bg-gray-800'
                }`}
              >
                {inviteLoading ? 'SENDING...' : 'SEND INVITATION'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}