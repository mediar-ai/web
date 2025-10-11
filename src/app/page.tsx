'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Homepage components
import ContactAdminSection from '@/components/homepage/ContactAdminSection';

function HomePage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();

  // Redirect unauthenticated users to sign-in
  useEffect(() => {
    if (isLoaded && !userId) {
      router.push('/sign-in');
    }
  }, [isLoaded, userId, router]);

  // Show loading while Clerk is initializing or while redirecting
  if (!isLoaded || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show contact admin section for all authenticated users
  return <ContactAdminSection userId={userId} />;
}

// Authentication-based homepage - deployed on $(date)
export default HomePage;