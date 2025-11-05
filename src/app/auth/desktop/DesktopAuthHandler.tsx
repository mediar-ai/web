'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

interface DesktopAuthHandlerProps {
  userId: string;
  email: string;
}

export default function DesktopAuthHandler({
  userId,
  email,
}: DesktopAuthHandlerProps) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  const [status, setStatus] = useState<
    'generating' | 'success' | 'error'
  >('generating');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function generateTokenAndStoreSession() {
      try {
        setStatus('generating');

        // If no session ID, use old deep link approach as fallback
        if (!sessionId) {
          // Call API to generate desktop token
          const response = await fetch('/api/auth/desktop-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          if (!response.ok) {
            throw new Error(`Failed to generate token: ${response.statusText}`);
          }

          const data = await response.json();

          if (!data.success || !data.token) {
            throw new Error(
              data.error || 'Failed to generate authentication token'
            );
          }

          // Fallback: Redirect to custom URL scheme with token
          const redirectUrl = `mediar://auth/callback?token=${data.token}&userId=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}`;
          window.location.href = redirectUrl;
          setStatus('success');
          return;
        }

        // New polling approach: Store token in session
        const response = await fetch('/api/auth/desktop-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        if (!response.ok) {
          throw new Error(`Failed to store session: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(
            data.error || 'Failed to authenticate desktop session'
          );
        }

        // Removed deep-link redirect - auto-polling handles authentication without browser popup
        // Desktop app polls /api/auth/desktop-session/{sessionId} every 2s and receives the token
        console.log('[Desktop Auth] Session stored, desktop app will authenticate via polling');

        setStatus('success');
      } catch (err) {
        console.error('Desktop auth error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setStatus('error');
      }
    }

    generateTokenAndStoreSession();
  }, [userId, email, sessionId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {status === 'generating' && (
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Authenticating Desktop App
            </h2>
            <p className="text-gray-600">
              Generating secure authentication token...
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg
                className="h-6 w-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Authentication Successful
            </h2>
            <p className="text-gray-600 mb-4">
              {sessionId
                ? 'You can now close this window and return to the desktop app.'
                : 'Redirecting to Mediar desktop app...'}
            </p>
            {!sessionId && (
              <p className="text-sm text-gray-500">
                If the app doesn&apos;t open automatically, please check that
                Mediar is installed.
              </p>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Authentication Failed
            </h2>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
