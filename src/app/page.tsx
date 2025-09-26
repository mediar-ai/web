'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Homepage components
import ContactAdminSection from '@/components/homepage/ContactAdminSection';
import LandingSection from '@/components/homepage/LandingSection';

function HomePage() {
  const { isLoaded, userId } = useAuth();
  const { organization, membership } = useOrganization();
  const router = useRouter();

  // Redirect to dashboard if user has organization access
  useEffect(() => {
    if (isLoaded && userId && organization && membership) {
      router.push('/dashboard');
    }
  }, [isLoaded, userId, organization, membership, router]);

  // Show loading while Clerk is initializing
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show landing page for unauthenticated users
  if (!userId) {
    return <LandingSection />;
  }

  // Check if user has organization membership - if not, show contact admin section
  if (!organization || !membership) {
    return <ContactAdminSection userId={userId} onStatusCheck={() => {}} isChecking={false} />;
  }

  // Show loading while redirecting to dashboard
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p className="text-gray-600">Redirecting to dashboard...</p>
      </div>
    </div>
  );
}

// Authentication-based homepage - deployed on $(date)
export default HomePage;