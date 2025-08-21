'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';

export default function SelectOrganizationPage() {
  const { isLoaded, userId } = useAuth();
  // Removed organization and router since we're not using auto-redirect anymore
  // const { organization } = useOrganization();
  // const router = useRouter();

  // Removed automatic redirect to admin - users can manually navigate to admin if needed
  // useEffect(() => {
  //   // If user has an active organization, redirect to dashboard
  //   if (isLoaded && organization) {
  //     router.push('/admin');
  //   }
  // }, [isLoaded, organization, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4">Please sign in to continue.</p>
            <Link href="/sign-in">
              <Button>Sign In</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Organization Selection Disabled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            Organization assignment is managed by administrators. You cannot select your own organization.
          </p>
          
          <div className="text-center">
            <Link href="/">
              <Button variant="outline">Back to Home</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 