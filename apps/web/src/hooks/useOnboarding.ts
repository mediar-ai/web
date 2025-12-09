'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';

export interface OnboardingState {
  id: string;
  user_id: string;
  followed_twitter: boolean;
  starred_github: boolean;
  followed_linkedin: boolean;
  joined_discord: boolean;
  watched_video: boolean;
  total_credits_earned: number;
  dismissed_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UseOnboardingReturn {
  onboarding: OnboardingState | null;
  shouldShowOnboarding: boolean;
  isLoading: boolean;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  followSocial: (platform: 'twitter' | 'github' | 'linkedin' | 'discord') => Promise<number>;
  watchVideo: () => Promise<number>;
  dismissOnboarding: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useOnboarding(): UseOnboardingReturn {
  const posthog = usePostHog();
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);

  const fetchOnboarding = useCallback(async () => {
    try {
      const response = await fetch('/api/onboarding');
      if (response.ok) {
        const data = await response.json();
        setOnboarding(data.onboarding);
        setShouldShowOnboarding(data.shouldShowOnboarding);
      }
    } catch (error) {
      console.error('Failed to fetch onboarding state:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOnboarding();
  }, [fetchOnboarding]);

  const followSocial = useCallback(
    async (platform: 'twitter' | 'github' | 'linkedin' | 'discord'): Promise<number> => {
      try {
        posthog?.capture('onboarding_social_follow', {
          platform,
          timestamp: new Date().toISOString(),
        });

        const response = await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'follow_social', platform }),
        });

        if (response.ok) {
          const data = await response.json();
          setOnboarding(data.onboarding);
          return data.creditsEarned || 0;
        }
        return 0;
      } catch (error) {
        console.error('Failed to track social follow:', error);
        return 0;
      }
    },
    [posthog]
  );

  const watchVideo = useCallback(async (): Promise<number> => {
    try {
      posthog?.capture('onboarding_watch_video', {
        timestamp: new Date().toISOString(),
      });

      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'watch_video' }),
      });

      if (response.ok) {
        const data = await response.json();
        setOnboarding(data.onboarding);
        return data.creditsEarned || 0;
      }
      return 0;
    } catch (error) {
      console.error('Failed to track video watch:', error);
      return 0;
    }
  }, [posthog]);

  const dismissOnboarding = useCallback(async () => {
    try {
      posthog?.capture('onboarding_dismissed', {
        step: currentStep,
        credits_earned: onboarding?.total_credits_earned || 0,
        timestamp: new Date().toISOString(),
      });

      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });

      if (response.ok) {
        const data = await response.json();
        setOnboarding(data.onboarding);
        setShouldShowOnboarding(false);
      }
    } catch (error) {
      console.error('Failed to dismiss onboarding:', error);
    }
  }, [posthog, currentStep, onboarding]);

  const completeOnboarding = useCallback(async () => {
    try {
      posthog?.capture('onboarding_completed', {
        credits_earned: onboarding?.total_credits_earned || 0,
        followed_twitter: onboarding?.followed_twitter,
        starred_github: onboarding?.starred_github,
        followed_linkedin: onboarding?.followed_linkedin,
        joined_discord: onboarding?.joined_discord,
        watched_video: onboarding?.watched_video,
        timestamp: new Date().toISOString(),
      });

      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });

      if (response.ok) {
        const data = await response.json();
        setOnboarding(data.onboarding);
        setShouldShowOnboarding(false);
      }
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
    }
  }, [posthog, onboarding]);

  return {
    onboarding,
    shouldShowOnboarding,
    isLoading,
    currentStep,
    setCurrentStep,
    followSocial,
    watchVideo,
    dismissOnboarding,
    completeOnboarding,
    refetch: fetchOnboarding,
  };
}
