'use client';

import { useUser } from '@clerk/nextjs';
import { useFeatureFlagEnabled } from 'posthog-js/react';

/**
 * Hook to check if user has access to the Playground feature.
 * Access is granted if:
 * 1. User has a @mediar.ai email (Mediar admin), OR
 * 2. User has the 'playground-access' feature flag enabled in PostHog
 */
export function usePlaygroundAccess() {
  const { user, isLoaded } = useUser();
  const hasFeatureFlag = useFeatureFlagEnabled('playground-access');

  const isMediarAdmin = user?.emailAddresses?.some(e =>
    e.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  return {
    hasAccess: isMediarAdmin || hasFeatureFlag === true,
    isMediarAdmin,
    hasFeatureFlag: hasFeatureFlag === true,
    isLoaded,
  };
}
