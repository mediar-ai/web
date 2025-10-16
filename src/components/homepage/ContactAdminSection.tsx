'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UserButton, useOrganizationList } from '@clerk/nextjs';
import { Play } from 'lucide-react';
import Link from 'next/link';
import { usePostHog } from 'posthog-js/react';
import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

interface ContactAdminSectionProps {
  userId: string;
}

// Mediar icon SVG component
const MediarIcon = ({ className = "w-16 h-16" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
    <rect width="24" height="24" rx="10" fill="#000"/>
    <g transform="translate(12 12) scale(0.65) translate(-12 -12)">
      <rect x="3" y="3" width="8" height="8" rx="2" fill="none" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      <path d="M7 11v4a2 2 0 0 0 2 2h4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
      <rect x="13" y="13" width="8" height="8" rx="2" fill="none" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
    </g>
  </svg>
);

export default function ContactAdminSection({
  userId
}: ContactAdminSectionProps) {
  const posthog = usePostHog();
  const { orgId } = useAuth();
  const { userMemberships, setActive, isLoaded } = useOrganizationList();

  // Auto-set the first organization if user has no active org
  useEffect(() => {
    if (isLoaded && !orgId && userMemberships?.data && userMemberships.data.length > 0) {
      const firstOrg = userMemberships.data[0];
      console.log(`[Homepage] Auto-setting first organization: ${firstOrg.organization.name} (${firstOrg.organization.id})`);
      setActive?.({ organization: firstOrg.organization.id });
    }
  }, [isLoaded, orgId, userMemberships, setActive]);

  const handleDownloadClick = () => {
    posthog?.capture('desktop_app_download_clicked', {
      user_id: userId,
      download_url: 'https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/nsis-x86_64',
      platform: 'windows',
      source: 'homepage',
      timestamp: new Date().toISOString()
    });
    console.log('Desktop app download button clicked');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header with signed-in status */}
      <div className="border-b-2 border-black bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MediarIcon className="w-10 h-10" />
            <h1 className="text-2xl font-bold text-black font-mono">MEDIAR</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">Signed in</div>
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "w-10 h-10 border-2 border-black"
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full space-y-6">
          {/* Welcome section */}
          <div className="text-center mb-8">
            <MediarIcon className="w-20 h-20 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-black mb-2 font-mono">Welcome to Mediar</h2>
          </div>

          {/* App Access Options */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Web App */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto">
                    <Play className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-black font-mono">WEB APP</h3>
                  <p className="text-gray-600 text-sm">
                    Record workflows in your browser
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
            <Card className="border-2 border-black hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-black font-mono">DESKTOP APP</h3>
                  <p className="text-gray-600 text-sm">
                    Record and build workflows with AI
                  </p>
                  <a
                    href="https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/nsis-x86_64"
                    download
                    onClick={handleDownloadClick}
                  >
                    <Button className="w-full bg-black text-white hover:bg-gray-800">
                      DOWNLOAD APP
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>

            {/* Dashboard */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow">
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
        </div>
      </div>
    </div>
  );
}