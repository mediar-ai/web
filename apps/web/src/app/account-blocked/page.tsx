'use client';

import { useSearchParams } from 'next/navigation';
import { useClerk } from '@clerk/nextjs';
import { ShieldOff, ShieldAlert, LogOut, Mail, Copy, Check } from 'lucide-react';
import { Suspense, useState } from 'react';

const SUPPORT_EMAIL = 'matt@mediar.ai';

function AccountBlockedContent() {
  const searchParams = useSearchParams();
  const { signOut } = useClerk();
  const [copied, setCopied] = useState(false);

  const status = searchParams.get('status') || 'suspended';
  const reason = searchParams.get('reason');

  const isTrialExpired = status === 'trial_expired';

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = SUPPORT_EMAIL;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
              ? 'Your trial period has ended. Please contact us to upgrade your account.'
              : 'Your account has been suspended. Please contact support for assistance.'
            )}
          </p>
        </div>

        {/* Contact Email */}
        <div className="mb-6">
          <p className="font-mono text-xs text-gray-600 text-center mb-2 uppercase">
            {isTrialExpired ? 'Contact us to upgrade' : 'Contact support'}
          </p>
          <div className="flex items-center gap-2 border-2 border-black p-3">
            <Mail className="w-4 h-4 flex-shrink-0" />
            <span className="font-mono text-sm flex-1">{SUPPORT_EMAIL}</span>
            <button
              onClick={copyEmail}
              className="flex items-center gap-1 px-2 py-1 font-mono text-xs font-bold border border-black hover:bg-black hover:text-white transition-colors"
              title="Copy email"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3" />
                  COPIED
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  COPY
                </>
              )}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${isTrialExpired ? 'Trial%20Upgrade%20Request' : 'Account%20Suspended%20-%20Help%20Request'}`}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-black text-white hover:bg-gray-800 transition-colors"
          >
            <Mail className="w-4 h-4" />
            OPEN EMAIL CLIENT
          </a>

          <button
            onClick={() => signOut({ redirectUrl: '/' })}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-white text-black hover:bg-black hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            SIGN OUT
          </button>
        </div>
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
