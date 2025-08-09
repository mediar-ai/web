'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';

// Homepage components
import ContactAdminSection from '@/components/homepage/ContactAdminSection';
import DashboardOverview from '@/components/homepage/DashboardOverview';
import LandingSection from '@/components/homepage/LandingSection';

function HomePage() {
  const { isLoaded, userId } = useAuth();
  const { organization, membership } = useOrganization();

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

  // Check if user has organization membership (Clerk-only authorization)
  if (!organization || !membership) {
    return <ContactAdminSection userId={userId} onStatusCheck={() => {}} isChecking={false} />;
  }

  // Show dashboard overview for users with organization access
  const isAdmin = membership.role === 'org:admin';
  const isOwner = membership.role === 'org:owner';
  
  const userStatus = {
    inDatabase: true,
    hasOrganization: true,
    organizationId: organization.id,
    organizationName: organization.name,
    userRole: membership.role,
  };
  
  return (
    <DashboardOverview
      userStatus={userStatus}
      userId={userId}
      isAdmin={isAdmin}
      isOwner={isOwner}
    />
  );
}

export default HomePage;