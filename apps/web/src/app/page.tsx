'use client';

import { useAuth } from '@clerk/nextjs';
import { UserButton, useOrganizationList } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Gift } from 'lucide-react';

// Homepage components
import { FreeEligibilitySurveyModal } from '@/components/homepage/FreeEligibilitySurveyModal';
import { OnboardingSection } from '@/components/onboarding/OnboardingSection';

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
  const [forceShowOnboarding, setForceShowOnboarding] = useState(false);

  // Get token from Stripe redirect for validation
  const purchaseToken = searchParams.get('token');

  // Redirect unauthenticated users to sign-in
  useEffect(() => {
    if (isLoaded && !userId) {
      router.push('/sign-in');
    }
  }, [isLoaded, userId, router]);

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

  // Fetch current price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await fetch('/api/price-generation');
        if (response.ok) {
          const data = await response.json();
          setCurrentPrice(data.currentPrice);
        }
      } catch (error) {
        console.error('Error fetching price:', error);
      }
    };
    fetchPrice();
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
          {/* App Access Options */}
          <div className="flex justify-center">
            {/* Desktop App */}
            <Card
              className={`border-2 border-black hover:shadow-lg transition-shadow flex flex-col relative w-full max-w-sm ${
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
                  Free trial
                </Button>
              )}
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
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
          </div>

          {/* Onboarding Section */}
          <OnboardingSection forceShow={forceShowOnboarding} onDismiss={() => setForceShowOnboarding(false)} />

          {/* DEV: Show onboarding button */}
          {process.env.NODE_ENV === 'development' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForceShowOnboarding(!forceShowOnboarding)}
              className="text-xs border-gray-300"
            >
              [DEV] {forceShowOnboarding ? 'Hide' : 'Show'} Onboarding
            </Button>
          )}

        </div>
      </div>

      {/* Free Eligibility Survey Modal */}
      <FreeEligibilitySurveyModal
        isOpen={showFreeEligibilityModal}
        onOpenChange={setShowFreeEligibilityModal}
        onSurveyComplete={handleFreeEligibilitySurveyComplete}
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
