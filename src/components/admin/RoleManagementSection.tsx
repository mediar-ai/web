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
    AlertCircle,
    Crown,
    RefreshCw,
    Shield,
    Trash2,
    User,
    Users
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

interface RoleManagementSectionProps {
  isOwner: boolean;
  currentUserId?: string;
}

export default function RoleManagementSection({ isOwner, currentUserId }: RoleManagementSectionProps) {
  const [orgUsers, setOrgUsers] = useState<OrganizationUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingUsers, setProcessingUsers] = useState<Set<string>>(new Set());

  // Fetch organization users from the existing admin API
  const fetchOrganizationUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // We'll need to enhance this to get org users - for now using a placeholder
      // This would typically call an API that lists all users in the organization
      const response = await fetch('/api/organization-users');
      if (!response.ok) {
        throw new Error(`Failed to fetch organization users: ${response.statusText}`);
      }
      
      const data = await response.json();
      setOrgUsers(data.users || []);
    } catch (err) {
      console.error('Error fetching organization users:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch organization users');
      // For now, set empty array if API doesn't exist yet
      setOrgUsers([]);
    } finally {
      setLoading(false);
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

  // Load data on mount
  useEffect(() => {
    if (isOwner) {
      fetchOrganizationUsers();
    }
  }, [isOwner]);

  // Don't render if not owner
  if (!isOwner) {
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
                  {/* Role Change Dropdown */}
                  {user.userId !== currentUserId && (
                    <>
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

                      {/* Remove User Button */}
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
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}