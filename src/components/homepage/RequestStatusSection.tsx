'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserButton } from '@clerk/nextjs';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Mail,
  MessageSquare,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface RequestStatus {
  hasRequest: boolean;
  status?: 'pending' | 'approved' | 'rejected';
  requestId?: string;
  ownerEmail?: string;
  organizationName?: string;
  requestedAt?: string;
  processedAt?: string;
  statusMessage?: string;
}

interface RequestStatusSectionProps {
  userId: string;
}

export default function RequestStatusSection({ userId: _userId }: RequestStatusSectionProps) {
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRequestStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/request-status');
      if (!response.ok) {
        throw new Error(`Failed to fetch request status: ${response.statusText}`);
      }
      
      const data = await response.json();
      setRequestStatus(data);
    } catch (err) {
      console.error('Error fetching request status:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch request status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequestStatus();
  }, []);

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-6 h-6 text-yellow-500" />;
      case 'approved':
        return <CheckCircle className="w-6 h-6 text-green-500" />;
      case 'rejected':
        return <XCircle className="w-6 h-6 text-red-500" />;
      default:
        return <MessageSquare className="w-6 h-6 text-gray-500" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'approved':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'rejected':
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getBadgeColor = (status?: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'approved':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="flex items-center space-x-2">
          <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
          <span className="text-gray-600">Checking request status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            {getStatusIcon(requestStatus?.status)}
          </div>
          <h1 className="text-3xl font-bold text-black mb-2">Access Request Status</h1>
          <p className="text-gray-600">
            Check the status of your organization access request.
          </p>
        </div>

        {/* Error State */}
        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-700">{error}</AlertDescription>
          </Alert>
        )}

        {/* Request Status */}
        {requestStatus && (
          <Card className="border-black-outline">
            <CardHeader>
              <CardTitle className="text-black flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Request Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {requestStatus.hasRequest ? (
                <>
                  {/* Status Alert */}
                  <Alert className={getStatusColor(requestStatus.status)}>
                    {getStatusIcon(requestStatus.status)}
                    <AlertDescription>
                      <strong>{requestStatus.statusMessage}</strong>
                    </AlertDescription>
                  </Alert>

                  {/* Request Info */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Status</span>
                      <Badge variant="outline" className={getBadgeColor(requestStatus.status)}>
                        {requestStatus.status?.toUpperCase()}
                      </Badge>
                    </div>

                    {requestStatus.organizationName && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Organization</span>
                        <span className="text-sm text-black">{requestStatus.organizationName}</span>
                      </div>
                    )}

                    {requestStatus.ownerEmail && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Sent to</span>
                        <span className="text-sm text-black">{requestStatus.ownerEmail}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">Requested</span>
                      <span className="text-sm text-gray-600">
                        {requestStatus.requestedAt && new Date(requestStatus.requestedAt).toLocaleDateString()}
                      </span>
                    </div>

                    {requestStatus.processedAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Processed</span>
                        <span className="text-sm text-gray-600">
                          {new Date(requestStatus.processedAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}


                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-4 border-t">
                    <Button
                      onClick={fetchRequestStatus}
                      variant="outline"
                      className="border-black-outline hover:bg-black hover:text-white"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh Status
                    </Button>

                    {requestStatus.status === 'rejected' && (
                      <Button 
                        onClick={() => window.location.reload()}
                        className="bg-black text-white hover:bg-gray-800"
                      >
                        Submit New Request
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-black mb-2">No Request Found</h3>
                  <p className="text-gray-600 mb-4">
                    You haven&apos;t submitted an access request yet.
                  </p>
                  <Button 
                    onClick={() => window.location.reload()}
                    className="bg-black text-white hover:bg-gray-800"
                  >
                    Submit Access Request
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Account Info */}
        <Card className="border-black-outline">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-black">Signed in</h4>
                <p className="text-sm text-gray-600">
                  Manage your account settings
                </p>
              </div>
              <UserButton 
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "w-10 h-10"
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500">
          <p>
            Need help? Contact support at{' '}
            <a 
              href="mailto:matt@mediar.ai" 
              className="text-black hover:underline"
            >
              matt@mediar.ai
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}