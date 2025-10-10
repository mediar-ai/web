'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserButton } from '@clerk/nextjs';
import { CheckCircle, Copy, Mail, MessageSquare, Play } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

interface ContactAdminSectionProps {
  userId: string;
}

export default function ContactAdminSection({
  userId
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

        {/* App Access Options */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Web App */}
          <Card className="border-2 border-black">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto">
                  <Play className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-black font-mono">WEB APP</h3>
                <p className="text-gray-600 text-sm">
                  Record and run workflows in your browser
                </p>
                <Link href="/web">
                  <Button className="w-full bg-black text-white hover:bg-gray-800">
                    OPEN WEB APP
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Desktop App */}
          <Card className="border-2 border-black">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-black font-mono">DESKTOP APP</h3>
                <p className="text-gray-600 text-sm">
                  Native desktop automation app
                </p>
                <Button className="w-full bg-gray-200 text-gray-500 border-2 border-gray-400 cursor-not-allowed" disabled>
                  COMING SOON
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dashboard */}
          <Card className="border-2 border-black">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-black font-mono">DASHBOARD</h3>
                <p className="text-gray-600 text-sm">
                  Manage workflows and deployments
                </p>
                <Link href="/dashboard">
                  <Button className="w-full bg-black text-white hover:bg-gray-800">
                    OPEN DASHBOARD
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

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