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
  const hasCapturedSurveyData = useRef(false);

  // Store survey data in localStorage when it arrives via URL params
  useEffect(() => {
    if (!hasCapturedSurveyData.current) {
      const submissionId = searchParams?.get('submissionId');
      const fromSurvey = searchParams?.get('fromSurvey');
      const email = searchParams?.get('email');
      const phDistinctId = searchParams?.get('phDistinctId'); // PostHog distinct ID from website

      if (submissionId && fromSurvey === 'true') {
        console.log('[PostHog] Storing survey data in localStorage:', {
          submissionId,
          email,
          fromSurvey,
          phDistinctId,
          timestamp: new Date().toISOString()
        });

        // Store in localStorage for persistence across auth redirects
        localStorage.setItem('mediar_survey_tracking', JSON.stringify({
          submissionId,
          email,
          fromSurvey,
          phDistinctId, // Store the website's PostHog ID
          timestamp: new Date().toISOString()
        }));

        hasCapturedSurveyData.current = true;
      }
    }
  }, [searchParams]);

  // Handle survey → user conversion tracking
  useEffect(() => {
    if (isSignedIn && user && posthog && !hasIdentified.current) {
      // First try URL params, then fall back to localStorage
      let submissionId = searchParams?.get('submissionId');
      let fromSurvey = searchParams?.get('fromSurvey');
      let surveyEmail = searchParams?.get('email');
      let websiteDistinctId = searchParams?.get('phDistinctId');

      // If no URL params, check localStorage
      if (!submissionId || !fromSurvey || !websiteDistinctId) {
        const storedData = localStorage.getItem('mediar_survey_tracking');
        if (storedData) {
          try {
            const parsed = JSON.parse(storedData);
            console.log('[PostHog] Found stored survey data:', parsed);
            submissionId = submissionId || parsed.submissionId;
            fromSurvey = fromSurvey || parsed.fromSurvey;
            surveyEmail = surveyEmail || parsed.email;
            websiteDistinctId = websiteDistinctId || parsed.phDistinctId;
          } catch (e) {
            console.error('[PostHog] Error parsing stored survey data:', e);
          }
        }
      }

      // Get the current anonymous ID for this domain
      const currentAnonymousId = posthog.get_distinct_id();

      // IMPORTANT: We need to handle multiple alias scenarios
      // 1. If we have the website's distinct ID (from survey), alias it to the user ID
      // 2. Also alias the current session's anonymous ID to the user ID

      // First, alias the website's distinct ID if it came from a survey
      if (websiteDistinctId && fromSurvey === 'true' && websiteDistinctId !== user.id) {
        console.log('[PostHog] Aliasing website distinct ID to user ID:', {
          websiteDistinctId,
          userId: user.id
        });
        // This links the survey events from the website to the user
        posthog.alias(user.id, websiteDistinctId);
      }

      // Then alias the current anonymous ID if different
      if (currentAnonymousId && currentAnonymousId !== user.id && currentAnonymousId !== websiteDistinctId) {
        console.log('[PostHog] Aliasing current anonymous ID to user ID:', {
          currentAnonymousId,
          userId: user.id
        });
        posthog.alias(user.id);
      }

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
          survey_email: surveyEmail || user.primaryEmailAddress?.emailAddress,
        });

        // Track conversion event
        posthog.capture('survey_to_user_conversion', {
          submission_id: submissionId,
          user_id: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          survey_email: surveyEmail,
          timestamp: new Date().toISOString(),
        });

        console.log('[PostHog] ✓ Survey conversion tracked');

        // Clear the stored data after successful tracking
        localStorage.removeItem('mediar_survey_tracking');
        console.log('[PostHog] Cleared stored survey data');
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
