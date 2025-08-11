'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrganizationSwitcher, useAuth } from '@clerk/nextjs';
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
          <CardTitle>Select Your Organization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            Please select your organization to access the admin dashboard.
          </p>
          
          <div className="flex justify-center">
            <OrganizationSwitcher 
              hidePersonal={true}
              afterSelectOrganizationUrl="/admin"
              appearance={{
                elements: {
                  organizationSwitcherTrigger: "w-full px-4 py-2 border rounded-md hover:bg-gray-50"
                }
              }}
            />
          </div>

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