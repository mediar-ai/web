'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useClerk } from '@clerk/nextjs';
import { LogOut, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LogoutPage() {
  const { signOut } = useClerk();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center">
              <LogOut className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-black mb-2">Sign Out</h1>
          <p className="text-gray-600">
            Are you sure you want to sign out of your account?
          </p>
        </div>

        {/* Logout Card */}
        <Card className="border-black-outline">
          <CardHeader>
            <CardTitle className="text-black text-center">
              Confirm Sign Out
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center text-sm text-gray-600 mb-6">
              You&apos;ll need to sign in again to access your account and workflows.
            </div>
            
            <div className="flex flex-col space-y-3">
              <Button
                onClick={handleSignOut}
                className="bg-black text-white hover:bg-gray-800 w-full"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Yes, Sign Me Out
              </Button>
              
              <Link href="/" className="w-full">
                <Button
                  variant="outline"
                  className="border-black text-black hover:bg-gray-50 w-full"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Cancel, Go Back
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-gray-500">
          <p>
            Need help? Contact{' '}
            <a 
              href="mailto:matt@mediar.ai" 
              className="text-black hover:underline"
            >
              matt@mediar.ai
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
