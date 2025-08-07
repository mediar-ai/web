'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    AlertCircle,
    CheckCircle,
    Clock,
    Mail,
    RefreshCw,
    UserPlus,
    UserX
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface PendingUser {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  joinedAt: string;
  role: string;
  requestId?: string;
  organizationName?: string;
}

interface PendingAccessRequestsProps {
  isOwner: boolean;
}

export default function PendingAccessRequests({ isOwner }: PendingAccessRequestsProps) {
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingUsers, setProcessingUsers] = useState<Set<string>>(new Set());

  // Fetch pending users
  const fetchPendingUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/pending-users');
      if (!response.ok) {
        throw new Error(`Failed to fetch pending users: ${response.statusText}`);
      }
      
      const data = await response.json();
      setPendingUsers(data.pendingUsers || []);
    } catch (err) {
      console.error('Error fetching pending users:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch pending users');
    } finally {
      setLoading(false);
    }
  };

  // Approve user
  const approveUser = async (userId: string, role: string = 'org:member', requestId?: string) => {
    setProcessingUsers(prev => new Set(prev).add(userId));
    
    try {
      const requestBody: any = { userIdToApprove: userId, role };
      if (requestId) {
        requestBody.requestId = requestId;
      }

      const response = await fetch('/api/approve-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to approve user: ${response.statusText}`);
      }
      
      // Remove from pending list
      setPendingUsers(prev => prev.filter(user => user.userId !== userId));
    } catch (err) {
      console.error('Error approving user:', err);
      setError(err instanceof Error ? err.message : 'Failed to approve user');
    } finally {
      setProcessingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Reject user request
  const rejectUser = async (userId: string, requestId?: string) => {
    if (!requestId) {
      setError('Cannot reject request: Request ID not found');
      return;
    }

    if (!confirm('Are you sure you want to reject this access request?')) {
      return;
    }

    setProcessingUsers(prev => new Set(prev).add(userId));
    
    try {
      const response = await fetch(`/api/access-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to reject request: ${response.statusText}`);
      }
      
      // Remove from pending list
      setPendingUsers(prev => prev.filter(user => user.userId !== userId));
    } catch (err) {
      console.error('Error rejecting request:', err);
      setError(err instanceof Error ? err.message : 'Failed to reject request');
    } finally {
      setProcessingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(userId);
        return newSet;
      });
    }
  };

  // Load data on mount
  useEffect(() => {
    if (isOwner) {
      fetchPendingUsers();
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
            <UserPlus className="w-5 h-5" />
            Pending Access Requests
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPendingUsers}
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
            <span className="ml-2 text-gray-600">Loading pending requests...</span>
          </div>
        ) : pendingUsers.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-black mb-2">No Pending Requests</h3>
            <p className="text-gray-600">
              All users in your organization have been approved.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingUsers.map((user) => (
              <div 
                key={user.userId} 
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <Mail className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <div className="font-medium text-black">
                      {user.firstName || user.lastName 
                        ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                        : user.email
                      }
                    </div>
                    <div className="text-sm text-gray-600">{user.email}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        <Clock className="w-3 h-3 mr-1" />
                        {new Date(user.joinedAt).toLocaleDateString()}
                      </Badge>
                      {user.organizationName && (
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                          {user.organizationName}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    onClick={() => approveUser(user.userId, 'org:member', user.requestId)}
                    disabled={processingUsers.has(user.userId)}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    {processingUsers.has(user.userId) ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <UserPlus className="w-4 h-4 mr-1" />
                    )}
                    Approve as Member
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approveUser(user.userId, 'org:admin', user.requestId)}
                    disabled={processingUsers.has(user.userId)}
                    className="border-blue-200 text-blue-700 hover:bg-blue-50"
                  >
                    {processingUsers.has(user.userId) ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <UserPlus className="w-4 h-4 mr-1" />
                    )}
                    Approve as Admin
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rejectUser(user.userId, user.requestId)}
                    disabled={processingUsers.has(user.userId)}
                    className="border-red-200 text-red-700 hover:bg-red-50"
                  >
                    {processingUsers.has(user.userId) ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <UserX className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}