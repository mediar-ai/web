'use client';

import { useAuth } from '@clerk/nextjs';

// Homepage components
import ContactAdminSection from '@/components/homepage/ContactAdminSection';
import LandingSection from '@/components/homepage/LandingSection';

function HomePage() {
  const { isLoaded, userId } = useAuth();

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

  // Show contact admin section for all authenticated users
  return <ContactAdminSection userId={userId} onStatusCheck={() => {}} isChecking={false} />;
}

// Authentication-based homepage - deployed on $(date)
export default HomePage;