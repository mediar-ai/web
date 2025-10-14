'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect, Suspense, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';

function PostHogPageViewInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const hasIdentified = useRef(false);

  // Handle survey → user conversion tracking
  useEffect(() => {
    if (isSignedIn && user && posthog && !hasIdentified.current) {
      const submissionId = searchParams?.get('submissionId');
      const fromSurvey = searchParams?.get('fromSurvey');
      const email = searchParams?.get('email');

      console.log('[PostHog] User signed in, identifying:', {
        userId: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        submissionId,
        fromSurvey
      });

      // Identify user with PostHog
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName || user.firstName || user.lastName,
      });

      // If user came from survey, track conversion and link to submission
      if (submissionId && fromSurvey === 'true') {
        console.log('[PostHog] Survey conversion detected, tracking with submission_id:', submissionId);

        // Set survey-related person properties
        posthog.setPersonProperties({
          survey_submission_id: submissionId,
          survey_source: 'mediar_website',
          survey_email: email || user.primaryEmailAddress?.emailAddress,
        });

        // Track conversion event
        posthog.capture('survey_to_user_conversion', {
          submission_id: submissionId,
          user_id: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          timestamp: new Date().toISOString(),
        });

        console.log('[PostHog] ✓ Survey conversion tracked');
      }

      hasIdentified.current = true;
    }
  }, [isSignedIn, user, searchParams]);

  // Track pageviews
  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname;
      if (searchParams && searchParams.toString()) {
        url = url + '?' + searchParams.toString();
      }

      posthog.capture('$pageview', {
        $current_url: url,
      });
    }
  }, [pathname, searchParams]);

  return null;
}

function PostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageViewInner />
    </Suspense>
  );
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
