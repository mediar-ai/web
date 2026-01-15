'use client';

import { useSearchParams } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { ShieldOff, ShieldAlert, LogOut, Mail } from 'lucide-react';
import { Suspense } from 'react';

function AccountBlockedContent() {
  const searchParams = useSearchParams();
  const { signOut } = useClerk();

  const status = searchParams.get('status') || 'suspended';
  const reason = searchParams.get('reason');

  const isTrialExpired = status === 'trial_expired';

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-black text-white flex items-center justify-center">
            {isTrialExpired ? (
              <ShieldOff className="w-10 h-10" />
            ) : (
              <ShieldAlert className="w-10 h-10" />
            )}
          </div>
        </div>

        {/* Title */}
        <h1 className="font-mono font-bold text-2xl text-center mb-4">
          {isTrialExpired ? 'TRIAL ENDED' : 'ACCOUNT SUSPENDED'}
        </h1>

        {/* Message */}
        <div className="border-2 border-black p-6 mb-6">
          <p className="font-mono text-sm text-center text-gray-700">
            {reason || (isTrialExpired
              ? 'Your trial period has ended. Please upgrade your account to continue using Mediar.'
              : 'Your account has been suspended. Please contact support for assistance.'
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {isTrialExpired && (
            <a
              href="mailto:support@mediar.ai?subject=Trial%20Upgrade%20Request"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-black text-white hover:bg-gray-800 transition-colors"
            >
              <Mail className="w-4 h-4" />
              CONTACT US TO UPGRADE
            </a>
          )}

          {!isTrialExpired && (
            <a
              href="mailto:support@mediar.ai?subject=Account%20Suspended%20-%20Help%20Request"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-black text-white hover:bg-gray-800 transition-colors"
            >
              <Mail className="w-4 h-4" />
              CONTACT SUPPORT
            </a>
          )}

          <button
            onClick={() => signOut({ redirectUrl: '/' })}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-white text-black hover:bg-black hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            SIGN OUT
          </button>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center font-mono text-xs text-gray-500">
          Questions? Email us at support@mediar.ai
        </p>
      </div>
    </div>
  );
}

export default function AccountBlockedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="font-mono text-gray-600">Loading...</div>
      </div>
    }>
      <AccountBlockedContent />
    </Suspense>
  );
}
