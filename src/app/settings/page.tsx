'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import { useOrganization, useUser } from '@clerk/nextjs';
import { Key, Users, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { organization } = useOrganization();
  const { user } = useUser();

  const settingsSections: Array<{
    title: string;
    description: string;
    href: string;
    icon: any;
    isDanger?: boolean;
  }> = [
    {
      title: 'Secrets',
      description: 'Manage encrypted secrets for workflows',
      href: '/settings/secrets',
      icon: Key,
    },
    {
      title: 'Team',
      description: 'Manage team members and invitations',
      href: '/settings/team',
      icon: Users,
    },
    {
      title: 'Danger Zone',
      description: 'Delete workflows and other destructive actions',
      href: '/settings/danger-zone',
      icon: AlertTriangle,
      isDanger: true,
    },
  ];

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-7xl mx-auto">
        {/* Header with org switcher */}
        <PageHeader
          title="Settings"
          subtitle="Manage your account and preferences"
        />

        {/* Settings Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.href}
                href={section.href}
                className={`block border-2 p-6 hover:bg-gray-50 transition-colors ${
                  section.isDanger ? 'border-black' : 'border-black'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 ${section.isDanger ? 'bg-black text-white' : 'bg-black text-white'}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-mono font-bold text-lg mb-1 uppercase">{section.title}</h2>
                    <p className="font-mono text-sm text-gray-600">{section.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* User Info Card */}
        <div className="mt-8 border-2 border-black p-6">
          <h2 className="font-mono font-bold text-lg mb-4">Account Information</h2>
          <div className="space-y-2 font-mono text-sm">
            <div className="flex">
              <span className="font-bold w-32">Name:</span>
              <span>{user?.fullName || 'Not set'}</span>
            </div>
            <div className="flex">
              <span className="font-bold w-32">Email:</span>
              <span>{user?.primaryEmailAddress?.emailAddress}</span>
            </div>
            <div className="flex">
              <span className="font-bold w-32">Organization:</span>
              <span>{organization?.name || 'None'}</span>
            </div>
            <div className="flex">
              <span className="font-bold w-32">User ID:</span>
              <span className="font-mono text-xs bg-gray-100 px-2 py-1">{user?.id}</span>
            </div>
          </div>
        </div>
        </div>
      </div>
    </DashboardLayout>
  );
}