'use client';

import { useCallback, useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { OnboardingProgress } from './OnboardingProgress';
import { SocialFollowCard } from './SocialFollowCard';
import { VideoStep } from './VideoStep';
import { useOnboarding } from '@/hooks/useOnboarding';
import { usePostHog } from 'posthog-js/react';
import { ArrowLeft, ArrowRight, Share2, Play, Gift } from 'lucide-react';

// Social platform icons
const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const LinkedInIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

const DiscordIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const SOCIAL_LINKS = {
  twitter: { url: 'https://x.com/ai_mediar', label: 'Follow us on X' },
  github: { url: 'https://github.com/mediar-ai/terminator', label: 'Star us on GitHub' },
  linkedin: { url: 'https://www.linkedin.com/company/105030539', label: 'Follow us on LinkedIn' },
  discord: { url: 'https://discord.gg/uP6jp2Cnhg', label: 'Join our Discord server' },
};

const INTRO_VIDEO = 'https://www.youtube.com/watch?v=v5qJ1pLcNY0';

const STEP_LABELS = ['Welcome!', 'Watch & Learn'];

interface OnboardingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OnboardingModal({ isOpen, onOpenChange }: OnboardingModalProps) {
  const {
    onboarding,
    currentStep,
    setCurrentStep,
    followSocial,
    watchVideo,
    dismissOnboarding,
    completeOnboarding,
  } = useOnboarding();

  const handleNext = useCallback(() => {
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
      onOpenChange(false);
    }
  }, [currentStep, setCurrentStep, completeOnboarding, onOpenChange]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep, setCurrentStep]);

  const handleDismiss = useCallback(() => {
    dismissOnboarding();
    onOpenChange(false);
  }, [dismissOnboarding, onOpenChange]);

  const totalCredits = onboarding?.total_credits_earned || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 border-2 border-white/20 overflow-hidden bg-black text-white">
        <div className="flex flex-col md:flex-row min-h-[500px]">
          {/* Left Panel - Main Content */}
          <div className="flex-1 p-6 flex flex-col bg-gradient-to-br from-gray-900 to-black">
            {/* Progress Indicator */}
            <OnboardingProgress
              currentStep={currentStep}
              totalSteps={2}
              stepLabels={STEP_LABELS}
            />

            {/* Credit Tip */}
            <div className="mt-4 mb-6 p-3 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Gift className="w-4 h-4 text-white" />
                <span className="font-mono text-gray-300">
                  TIP: You can get <strong className="text-white">10 free credits</strong> by completing onboarding
                </span>
              </div>
              {totalCredits > 0 && (
                <div className="mt-1 text-xs font-mono text-gray-400">
                  You&apos;ve earned: <strong className="text-white">{totalCredits} credits</strong> so far
                </div>
              )}
            </div>

            {/* Step Content */}
            <div className="flex-1">
              {currentStep === 1 && (
                <div className="space-y-4">
                  <h2 className="text-2xl font-mono font-bold text-white">Welcome!</h2>
                  <p className="text-gray-400">
                    You can earn free credits by following us on social media!
                  </p>

                  <div className="space-y-3 mt-6">
                    <SocialFollowCard
                      platform="twitter"
                      icon={<TwitterIcon />}
                      label={SOCIAL_LINKS.twitter.label}
                      url={SOCIAL_LINKS.twitter.url}
                      credits={2}
                      isCompleted={onboarding?.followed_twitter || false}
                      onComplete={() => followSocial('twitter')}
                    />
                    <SocialFollowCard
                      platform="github"
                      icon={<GitHubIcon />}
                      label={SOCIAL_LINKS.github.label}
                      url={SOCIAL_LINKS.github.url}
                      credits={2}
                      isCompleted={onboarding?.starred_github || false}
                      onComplete={() => followSocial('github')}
                    />
                    <SocialFollowCard
                      platform="linkedin"
                      icon={<LinkedInIcon />}
                      label={SOCIAL_LINKS.linkedin.label}
                      url={SOCIAL_LINKS.linkedin.url}
                      credits={2}
                      isCompleted={onboarding?.followed_linkedin || false}
                      onComplete={() => followSocial('linkedin')}
                    />
                    <SocialFollowCard
                      platform="discord"
                      icon={<DiscordIcon />}
                      label={SOCIAL_LINKS.discord.label}
                      url={SOCIAL_LINKS.discord.url}
                      credits={2}
                      isCompleted={onboarding?.joined_discord || false}
                      onComplete={() => followSocial('discord')}
                    />
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-4">
                  <h2 className="text-2xl font-mono font-bold text-white">Watch & Learn</h2>
                  <p className="text-gray-400">
                    See Mediar in action! Watch this quick intro to get started.
                  </p>

                  <div className="mt-6">
                    <VideoStep
                      videoUrl={INTRO_VIDEO}
                      isCompleted={onboarding?.watched_video || false}
                      onComplete={watchVideo}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-white/10 mt-4">
              <div className="flex items-center gap-2">
                {currentStep > 1 && (
                  <Button
                    variant="outline"
                    onClick={handleBack}
                    className="border border-white/20 bg-transparent text-white hover:bg-white hover:text-black"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={handleDismiss}
                  className="text-gray-500 hover:text-white hover:bg-white/10"
                >
                  Maybe later
                </Button>
              </div>

              <Button
                onClick={handleNext}
                className="bg-white text-black hover:bg-gray-200"
              >
                {currentStep === 2 ? 'Finish' : 'Next'}
                {currentStep !== 2 && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </div>
          </div>

          {/* Right Panel - Illustration */}
          <div className="hidden md:flex w-80 bg-gradient-to-br from-gray-800 to-gray-900 p-8 flex-col items-center justify-center text-white border-l border-white/10">
            <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-6">
              {currentStep === 1 ? (
                <Share2 className="w-10 h-10 text-white" />
              ) : (
                <Play className="w-10 h-10 text-white" />
              )}
            </div>
            <h3 className="text-xl font-bold text-center mb-2 text-white">
              {currentStep === 1
                ? 'Connect with us on social media!'
                : 'See Mediar in action!'}
            </h3>
            <p className="text-gray-400 text-sm text-center">
              {currentStep === 1
                ? 'Follow us and earn credits for each platform you join'
                : 'Watch a quick intro and earn 2 credits'}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
