'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import RoleManagementSection from '@/components/admin/RoleManagementSection';
import { useAuth, useOrganization } from '@clerk/nextjs';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function TeamPage() {
  const { userId } = useAuth();
  const { organization: _organization, membership } = useOrganization();
  const isOwner = membership?.role === 'org:owner';
  const isAdmin = membership?.role === 'org:admin' || membership?.role === 'org:owner';

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Breadcrumb */}
        <Link href="/settings" className="inline-flex items-center gap-2 font-mono text-sm mb-6 hover:underline">
          <ArrowLeft className="w-4 h-4" />
          Settings
        </Link>

        {/* Header with org switcher */}
        <PageHeader
          title="Team Management"
          subtitle="Manage team members and their permissions"
        />

        {/* Team Management Section */}
        {isAdmin ? (
          <RoleManagementSection isOwner={isOwner} isAdmin={isAdmin} currentUserId={userId || undefined} />
        ) : (
          <div className="border-2 border-black bg-gray-50 p-6">
            <p className="font-mono">You need admin or owner permissions to manage team members.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}