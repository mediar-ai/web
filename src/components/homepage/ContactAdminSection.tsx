'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UserButton, useAuth, useOrganizationList } from '@clerk/nextjs';
import { Play, Briefcase } from 'lucide-react';
import Link from 'next/link';
import { usePostHog } from 'posthog-js/react';
import { useEffect, useState } from 'react';

interface ContactAdminSectionProps {
  userId: string;
}

// Mediar icon SVG component
const MediarIcon = ({ className = 'w-16 h-16' }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className={className}
  >
    <rect width="24" height="24" rx="10" fill="#000" />
    <g transform="translate(12 12) scale(0.65) translate(-12 -12)">
      <rect
        x="3"
        y="3"
        width="8"
        height="8"
        rx="2"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M7 11v4a2 2 0 0 0 2 2h4"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x="13"
        y="13"
        width="8"
        height="8"
        rx="2"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  </svg>
);

export default function ContactAdminSection({
  userId,
}: ContactAdminSectionProps) {
  const posthog = usePostHog();
  const { orgId } = useAuth();
  const { userMemberships, setActive, isLoaded } = useOrganizationList();
  const [hasAnsweredSource, setHasAnsweredSource] = useState(true); // Default to true to avoid flash

  // Check if user has already answered
  useEffect(() => {
    const answered = localStorage.getItem('referral_source_answered');
    setHasAnsweredSource(!!answered);
  }, []);

  // Auto-set the first organization if user has no active org
  useEffect(() => {
    if (
      isLoaded &&
      !orgId &&
      userMemberships?.data &&
      userMemberships.data.length > 0
    ) {
      const firstOrg = userMemberships.data[0];
      console.log(
        `[Homepage] Auto-setting first organization: ${firstOrg.organization.name} (${firstOrg.organization.id})`
      );
      setActive?.({ organization: firstOrg.organization.id });
    }
  }, [isLoaded, orgId, userMemberships, setActive]);

  const handleDownloadClick = () => {
    posthog?.capture('desktop_app_download_clicked', {
      user_id: userId,
      download_url:
        'https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/windows-x86_64',
      platform: 'windows',
      source: 'homepage',
      timestamp: new Date().toISOString(),
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
                  avatarBox: 'w-10 h-10 border-2 border-black',
                },
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
            <h1 className="text-4xl font-bold text-black mb-8 font-mono">
              Welcome to Mediar Beta!
            </h1>
          </div>

          {/* App Access Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Web App */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <Play className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-black font-mono mb-4">
                    WEB APP
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
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
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-black font-mono mb-4">
                    DESKTOP APP
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Build automated workflows
                  </p>
                  <a
                    href="https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/windows-x86_64"
                    download
                    onClick={handleDownloadClick}
                  >
                    <Button className="w-full bg-black text-white hover:bg-gray-800 whitespace-normal h-auto py-2">
                      DOWNLOAD APP (Windows)
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>

            {/* Dashboard */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-black font-mono mb-4">
                    DASHBOARD
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
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

            {/* Turnkey Service - B2B offering */}
            <Card className="border-2 border-dashed border-black bg-gray-50 hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <Briefcase className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-black font-mono mb-2">
                    TURNKEY SERVICE
                  </h3>
                  <p className="text-xs text-gray-500 font-mono uppercase mb-3">
                    B2B Consulting
                  </p>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    We build the automation for you
                  </p>
                  <a
                    href="https://mediar.ai/turnkey"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button className="w-full bg-white text-black border-2 border-black hover:bg-black hover:text-white transition-colors">
                      REQUEST CONSULTATION
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* How did you hear about us - moved below cards */}
          {!hasAnsweredSource && (
            <div className="mt-8 text-center relative z-50">
              <label className="text-xs font-mono text-gray-600 uppercase block mb-2">
                How did you hear about us?
              </label>
              <select
                className="w-64 mx-auto block border-2 border-black p-2 font-mono text-sm relative z-50"
                onChange={e => {
                  if (e.target.value) {
                    // Save to localStorage
                    localStorage.setItem(
                      'referral_source_answered',
                      e.target.value
                    );
                    localStorage.setItem(
                      'referral_source_date',
                      new Date().toISOString()
                    );

                    // Send to PostHog
                    posthog?.capture('referral_source_selected', {
                      source: e.target.value,
                      user_id: userId,
                      timestamp: new Date().toISOString(),
                    });

                    // Hide the dropdown
                    setHasAnsweredSource(true);
                  }
                }}
              >
                <option value="">Select...</option>
                <option value="twitter">Twitter/X</option>
                <option value="linkedin">LinkedIn</option>
                <option value="hackernews">Hacker News</option>
                <option value="producthunt">Product Hunt</option>
                <option value="friend">Friend/Colleague</option>
                <option value="google">Google Search</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
