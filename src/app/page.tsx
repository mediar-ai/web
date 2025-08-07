'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useState } from 'react';

// Homepage components
import DashboardOverview from '@/components/homepage/DashboardOverview';
import LandingSection from '@/components/homepage/LandingSection';
import RequestAccessForm from '@/components/homepage/RequestAccessForm';
import RequestStatusSection from '@/components/homepage/RequestStatusSection';

interface UserStatus {
  inDatabase: boolean;
  hasOrganization: boolean;
  organizationId?: string;
  organizationName?: string;
  userRole?: string;
  hasActiveRequest?: boolean;
}

function HomePage() {
  const { isLoaded, userId } = useAuth();
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // Check user status in database
  const checkUserStatus = async () => {
    if (!userId) return;
    
    setIsCheckingStatus(true);
    try {
      // Check both user status and request status in parallel
      const [userResponse, requestResponse] = await Promise.all([
        fetch('/api/user-status'),
        fetch('/api/request-status')
      ]);

      let status = {
        inDatabase: false,
        hasOrganization: false,
        hasActiveRequest: false
      };

      if (userResponse.ok) {
        const userStatus = await userResponse.json();
        status = { ...status, ...userStatus };
      }

      if (requestResponse.ok) {
        const requestStatus = await requestResponse.json();
        status.hasActiveRequest = requestStatus.hasRequest && requestStatus.status === 'pending';
      }

      setUserStatus(status);
    } catch (error) {
      console.error('Error checking user status:', error);
      // Default to requiring access request
      setUserStatus({
        inDatabase: false,
        hasOrganization: false,
        hasActiveRequest: false
      });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  useEffect(() => {
    if (isLoaded && userId) {
      checkUserStatus();
    }
  }, [isLoaded, userId]);

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

  // Show loading while checking user status
  if (isCheckingStatus || !userStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking access...</p>
        </div>
    </div>
  );
}

  // Show request status or access form for users not in database or without organization
  if (!userStatus.inDatabase || !userStatus.hasOrganization) {
    // If user has an active request, show status instead of form
    if (userStatus.hasActiveRequest) {
      return <RequestStatusSection userId={userId} />;
    }
    return <RequestAccessForm userId={userId} />;
  }

  // Show dashboard overview for users with full access
  const isAdmin = userStatus.userRole === 'org:admin';
  const isOwner = userStatus.userRole === 'org:owner';
  
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