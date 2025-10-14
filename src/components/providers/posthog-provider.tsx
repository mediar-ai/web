'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSignedIn } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname;
      if (searchParams && searchParams.toString()) {
        url = url + '?' + searchParams.toString();
      }

      // Identify user if signed in
      if (isSignedIn && user) {
        posthog.identify(user.id, {
          email: user.primaryEmailAddress?.emailAddress,
          name: user.fullName || user.firstName || user.lastName,
        });
      }

      posthog.capture('$pageview', {
        $current_url: url,
      });
    }
  }, [pathname, searchParams, isSignedIn, user]);

  return null;
}

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        capture_pageview: false, // We'll handle this manually
        capture_pageleave: true,
        autocapture: false, // Disable auto-capture for cleaner events
      });
    }
  }, []);

  return (
    <PostHogProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PostHogProvider>
  );
}
