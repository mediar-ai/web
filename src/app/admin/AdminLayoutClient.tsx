'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Shield } from 'lucide-react';

function AdminUnauthorized() {
  return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center border-2 border-black p-8 max-w-md">
          <Shield className="w-16 h-16 mx-auto mb-4" />
          <h1 className="font-mono font-bold text-2xl mb-2">ACCESS DENIED</h1>
          <p className="font-mono text-gray-600 mb-4">
            This area is restricted to Mediar administrators only.
          </p>
          <Link
            href="/dashboard"
            className="inline-block px-4 py-2 border-2 border-black font-mono hover:bg-black hover:text-white transition-colors"
          >
            GO TO DASHBOARD
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}

function AdminLoading() {
  return (
    <DashboardLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4" />
          <p className="font-mono text-gray-600">Loading...</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

export function AdminLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoaded } = useUser();

  // Check if user is Mediar admin (has @mediar.ai email)
  const isMediarAdmin =
    user?.emailAddresses?.some(email =>
      email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

  if (!isLoaded) {
    return <AdminLoading />;
  }

  if (!isMediarAdmin) {
    return <AdminUnauthorized />;
  }

  return (
    <DashboardLayout>
      {children}
    </DashboardLayout>
  );
}
