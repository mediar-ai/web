'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import { useOrganization, useUser } from '@clerk/nextjs';

export default function AccountPage() {
  const { organization, membership } = useOrganization();
  const { user } = useUser();

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-4xl mx-auto">
          <PageHeader
            title="Account"
            subtitle="View your account information"
          />

          {/* User Info Card */}
          <div className="border-2 border-black p-6 bg-white">
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
                <span className="font-bold w-32">Role:</span>
                <span>{membership?.role?.replace('org:', '') || 'N/A'}</span>
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
