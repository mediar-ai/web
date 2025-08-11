'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserButton } from '@clerk/nextjs';
import { CheckCircle, Copy, Mail, MessageSquare, Play, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

interface ContactAdminSectionProps {
  userId: string;
  onStatusCheck: () => void;
  isChecking: boolean;
}

export default function ContactAdminSection({ 
  userId, 
  onStatusCheck, 
  isChecking 
}: ContactAdminSectionProps) {
  const [copied, setCopied] = useState(false);

  const copyUserId = async () => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy user ID:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-black mb-2">Welcome to Mediar!</h1>
          <p className="text-gray-600">
            Your account has been created, but you need organization access to continue.
          </p>
        </div>

        {/* Web Workflows Access */}
        <Card className="border-black-outline">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <h3 className="text-lg font-semibold text-black">Try Web Workflows</h3>
              <p className="text-gray-600">
                You can still access our web workflow recorder while waiting for organization access.
              </p>
              <Link href="/web">
                <Button className="bg-black text-white hover:bg-gray-800">
                  <Play className="w-4 h-4 mr-2" />
                  Web Workflows
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Main Card */}
        <Card className="border-black-outline">
          <CardHeader>
            <CardTitle className="text-black flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Contact Your Administrator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* User ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Your User ID
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 bg-gray-100 rounded border font-mono text-sm">
                  {userId}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyUserId}
                  className="border-black-outline hover:bg-black hover:text-white"
                >
                  {copied ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Share this ID with your administrator to get access
              </p>
            </div>

            {/* Instructions */}
            <Alert>
              <Mail className="w-4 h-4" />
              <AlertDescription>
                <strong>To get access:</strong>
                <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                  <li>Contact your organization administrator or team lead</li>
                  <li>Share your User ID (shown above)</li>
                  <li>Request to be added to your organization</li>
                  <li>Check back here once access has been granted</li>
                </ol>
              </AlertDescription>
            </Alert>

            {/* Contact Info */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-black mb-2">Need Help?</h4>
              <div className="space-y-2 text-sm text-gray-600">
                <p>
                  <strong>Support Email:</strong>{' '}
                  <a 
                    href="mailto:matt@mediar.ai" 
                    className="text-black hover:underline"
                  >
                    matt@mediar.ai
                  </a>
                </p>
                <p>
                  <strong>What to include:</strong> Your User ID and organization name
                </p>
              </div>
            </div>

            {/* Status Check Button */}
            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-gray-600">
                Access granted? Check your status
              </div>
              <Button
                onClick={onStatusCheck}
                disabled={isChecking}
                className="bg-black text-white hover:bg-gray-800"
              >
                {isChecking ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Check Access Status
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

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
            This process ensures secure access to your organization&apos;s workflows and data.
          </p>
        </div>
      </div>
    </div>
  );
}