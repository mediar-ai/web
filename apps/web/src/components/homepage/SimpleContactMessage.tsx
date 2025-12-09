'use client';

import { useUser } from '@clerk/nextjs';

export default function SimpleContactMessage() {
  const { user } = useUser();

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="max-w-md w-full text-center border border-black rounded-lg p-8">
        <h2 className="text-2xl font-bold text-black mb-4">Organization Access Required</h2>
        <p className="text-black mb-6">
          You need to be invited to an organization to access this application.
        </p>
        
        <div className="bg-white border border-black rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-black mb-2">Contact Administrator</h3>
          <p className="text-sm text-black mb-3">
            Email your administrator to request access:
          </p>
          <p className="font-mono text-sm text-black">admin@mediar.ai</p>
        </div>
        
        <div className="text-sm text-black">
          <p className="mb-1">Include your details:</p>
          <div className="bg-white border border-black rounded-lg p-2">
            <p><strong>Name:</strong> {user?.fullName || 'Not provided'}</p>
            <p><strong>Email:</strong> {user?.emailAddresses[0]?.emailAddress || 'Not provided'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}