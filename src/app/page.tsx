'use client';

import { useAuth } from '@clerk/nextjs';
import { UserButton, useOrganizationList } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Briefcase, Loader2, Gift } from 'lucide-react';
import Link from 'next/link';

// Homepage components
import PricingSection from '@/components/homepage/PricingSection';
import { FreeEligibilitySurveyModal } from '@/components/homepage/FreeEligibilitySurveyModal';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { useOnboarding } from '@/hooks/useOnboarding';

// Mediar icon SVG component
const MediarIcon = ({ className = 'w-16 h-16' }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className={className}
  >
    <rect width="24" height="24" rx="10" fill="#000" />
    <g transform="translate(12 12) scale(0.65) translate(-12 -12)">
      <rect
        x="3"
        y="3"
        width="8"
        height="8"
        rx="2"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M7 11v4a2 2 0 0 0 2 2h4"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x="13"
        y="13"
        width="8"
        height="8"
        rx="2"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  </svg>
);

function HomePageContent() {
  const { isLoaded, userId, orgId } = useAuth();
  const { userMemberships, setActive, isLoaded: orgListLoaded } = useOrganizationList();
  const router = useRouter();
  const searchParams = useSearchParams();
  const posthog = usePostHog();
  const [hasPurchased, setHasPurchased] = useState<boolean | null>(null);
  const [checkingPurchase, setCheckingPurchase] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showFreeEligibilityModal, setShowFreeEligibilityModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  // Onboarding state
  const { shouldShowOnboarding, isLoading: isOnboardingLoading } = useOnboarding();

  // Get token from Stripe redirect for validation
  const purchaseToken = searchParams.get('token');

  // Redirect unauthenticated users to sign-in
  useEffect(() => {
    if (isLoaded && !userId) {
      router.push('/sign-in');
    }
  }, [isLoaded, userId, router]);

  // Show onboarding modal when appropriate
  useEffect(() => {
    if (!isOnboardingLoading && shouldShowOnboarding && !checkingPurchase) {
      // Small delay to let the page render first
      const timer = setTimeout(() => {
        setShowOnboardingModal(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isOnboardingLoading, shouldShowOnboarding, checkingPurchase]);

  // Auto-set the first organization if user has no active org
  useEffect(() => {
    if (
      orgListLoaded &&
      !orgId &&
      userMemberships?.data &&
      userMemberships.data.length > 0
    ) {
      const firstOrg = userMemberships.data[0];
      console.log(
        `[Homepage] Auto-setting first organization: ${firstOrg.organization.name} (${firstOrg.organization.id})`
      );
      setActive?.({ organization: firstOrg.organization.id });
    }
  }, [orgListLoaded, orgId, userMemberships, setActive]);

  // Check purchase status
  useEffect(() => {
    if (!userId) return;

    const checkPurchaseStatus = async () => {
      try {
        const url = purchaseToken
          ? `/api/purchase-status?token=${encodeURIComponent(purchaseToken)}`
          : '/api/purchase-status';
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setHasPurchased(data.hasPurchased);
        }
      } catch (error) {
        console.error('Error checking purchase status:', error);
      } finally {
        setCheckingPurchase(false);
      }
    };

    checkPurchaseStatus();
  }, [userId, purchaseToken]);

  const handlePriceLoaded = useCallback((price: number) => {
    setCurrentPrice(price);
  }, []);

  const handleFreeEligibilitySurveyComplete = useCallback(() => {
    // User completed the survey and got free access
    setHasPurchased(true);
    setShowFreeEligibilityModal(false);
    posthog?.capture('free_eligibility_access_granted', {
      user_id: userId,
      timestamp: new Date().toISOString(),
    });
  }, [posthog, userId]);

  const handleDownloadClick = () => {
    posthog?.capture('desktop_app_download_clicked', {
      user_id: userId,
      download_url:
        'https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/windows-x86_64',
      platform: 'windows',
      source: 'homepage',
      timestamp: new Date().toISOString(),
    });
  };

  const handleCheckout = async () => {
    if (!currentPrice) return;

    setCheckoutLoading(true);
    posthog?.capture('checkout_initiated', { price: currentPrice });

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: currentPrice,
          returnUrl: window.location.href,
        }),
      });

      if (!response.ok) throw new Error('checkout failed');

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('checkout error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Show loading while Clerk is initializing or checking purchase
  if (!isLoaded || !userId || checkingPurchase) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
          <p className="text-gray-600 font-mono">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="border-b-2 border-black bg-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MediarIcon className="w-10 h-10" />
            <h1 className="text-2xl font-bold text-black font-mono">MEDIAR</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">Signed in</div>
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: 'w-10 h-10 border-2 border-black',
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Welcome section */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-black mb-8 font-mono">
              Welcome to Mediar Beta!
            </h1>
            {/* DEV ONLY: Force show onboarding */}
            {process.env.NODE_ENV === 'development' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOnboardingModal(true)}
                className="mb-4 text-xs"
              >
                [DEV] Show Onboarding
              </Button>
            )}
          </div>

          {/* Pricing section for unpaid users */}
          {!hasPurchased && (
            <PricingSection onPriceLoaded={handlePriceLoaded} />
          )}

          {/* App Access Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Web App */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <Play className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Record workflows in your browser
                  </p>
                  <Link href="/web">
                    <Button className="w-full bg-black text-white hover:bg-gray-800">
                      OPEN WEB APP
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Desktop App */}
            <Card
              className={`border-2 border-black hover:shadow-lg transition-shadow flex flex-col relative ${
                purchaseToken && hasPurchased
                  ? 'ring-4 ring-black ring-offset-2 shadow-lg'
                  : ''
              }`}
            >
              {/* Free eligibility button - only show when not purchased */}
              {!hasPurchased && (
                <Button
                  onClick={() => setShowFreeEligibilityModal(true)}
                  variant="outline"
                  size="sm"
                  className="absolute -top-2 -right-2 z-10 bg-white border-2 border-black hover:bg-black hover:text-white font-mono text-xs px-2 py-1 h-auto shadow-md"
                >
                  <Gift className="w-3 h-3 mr-1" />
                  Free?
                </Button>
              )}
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Build automated workflows
                  </p>
                  {hasPurchased ? (
                    <a
                      href="https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/windows-x86_64"
                      download
                      onClick={handleDownloadClick}
                    >
                      <Button
                        className="w-full bg-black text-white hover:bg-gray-800 whitespace-normal h-auto py-2 animate-shake hover:animate-none"
                      >
                        DOWNLOAD APP (Windows)
                      </Button>
                    </a>
                  ) : (
                    <Button
                      onClick={handleCheckout}
                      disabled={checkoutLoading || !currentPrice}
                      className="w-full bg-black text-white hover:bg-gray-800 whitespace-normal h-auto py-2"
                    >
                      {checkoutLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : currentPrice ? (
                        `BUY NOW - $${currentPrice} CREDITS`
                      ) : (
                        'Loading...'
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Dashboard */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-6 h-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"
                      />
                    </svg>
                  </div>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Manage workflows and deployments
                  </p>
                  <Link href="/dashboard">
                    <Button className="w-full bg-black text-white hover:bg-gray-800">
                      OPEN DASHBOARD
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Turnkey Service */}
            <Card className="border-2 border-dashed border-black bg-gray-50 hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
                    <Briefcase className="w-6 h-6 text-white" />
                  </div>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    We build the automation for you
                  </p>
                  <a
                    href="https://mediar.ai/turnkey"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button className="w-full bg-white text-black border-2 border-black hover:bg-black hover:text-white transition-colors">
                      REQUEST CONSULTATION
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>

      {/* Free Eligibility Survey Modal */}
      <FreeEligibilitySurveyModal
        isOpen={showFreeEligibilityModal}
        onOpenChange={setShowFreeEligibilityModal}
        onSurveyComplete={handleFreeEligibilitySurveyComplete}
      />

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboardingModal}
        onOpenChange={setShowOnboardingModal}
      />
    </div>
  );
}

function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
            <p className="text-gray-600 font-mono">Loading...</p>
          </div>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}

export default HomePage;
