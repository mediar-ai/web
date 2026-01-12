'use client';

import { useAuth } from '@clerk/nextjs';
import { UserButton, useOrganizationList } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { usePostHog } from 'posthog-js/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
// COMMENTED OUT: Purchase flow imports
// import { useSearchParams } from 'next/navigation';
// import { useCallback } from 'react';
// import { Loader2, Gift } from 'lucide-react';
// import { FreeEligibilitySurveyModal } from '@/components/homepage/FreeEligibilitySurveyModal';
// import { OnboardingSection } from '@/components/onboarding/OnboardingSection';

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
  const posthog = usePostHog();
  const [navigatingToDashboard, setNavigatingToDashboard] = useState(false);
  const [navigatingToWebApp, setNavigatingToWebApp] = useState(false);

  // COMMENTED OUT: Purchase flow state
  // const searchParams = useSearchParams();
  // const [hasPurchased, setHasPurchased] = useState<boolean | null>(null);
  // const [checkingPurchase, setCheckingPurchase] = useState(true);
  // const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  // const [checkoutLoading, setCheckoutLoading] = useState(false);
  // const [showFreeEligibilityModal, setShowFreeEligibilityModal] = useState(false);
  // const [forceShowOnboarding, setForceShowOnboarding] = useState(false);
  // const purchaseToken = searchParams.get('token');

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

  // COMMENTED OUT: Purchase flow effects and handlers
  /*
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
  */

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

  // COMMENTED OUT: Purchase checkout handler
  /*
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
  */

  // Show loading while Clerk is initializing
  if (!isLoaded || !userId) {
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
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full space-y-6">
          {/* Welcome section */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-black font-mono">
              Welcome to Mediar
            </h1>
          </div>

          {/* 3 Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Web App */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <h3 className="text-lg font-bold text-black font-mono mb-4">
                    WEB APP
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Record workflows in your browser
                  </p>
                  <Button
                    className="w-full bg-black text-white hover:bg-gray-800"
                    disabled={navigatingToWebApp}
                    onClick={() => {
                      setNavigatingToWebApp(true);
                      router.push('/web');
                    }}
                  >
                    {navigatingToWebApp ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        LOADING...
                      </>
                    ) : (
                      'OPEN WEB APP'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Download App */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <h3 className="text-lg font-bold text-black font-mono mb-4">
                    DOWNLOAD APP
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Build automated workflows
                  </p>
                  <a
                    href="https://cdn.crabnebula.app/download/mediar/mediar/latest/platform/windows-x86_64"
                    download
                    onClick={handleDownloadClick}
                  >
                    <Button className="w-full bg-black text-white hover:bg-gray-800">
                      DOWNLOAD (Windows)
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>

            {/* Dashboard */}
            <Card className="border-2 border-black hover:shadow-lg transition-shadow flex flex-col">
              <CardContent className="pt-6 h-full">
                <div className="flex flex-col h-full text-center">
                  <h3 className="text-lg font-bold text-black font-mono mb-4">
                    DASHBOARD
                  </h3>
                  <p className="text-gray-600 text-sm mb-4 flex-1">
                    Manage workflows and deployments
                  </p>
                  <Button
                    className="w-full bg-black text-white hover:bg-gray-800"
                    disabled={navigatingToDashboard}
                    onClick={() => {
                      setNavigatingToDashboard(true);
                      router.push('/dashboard');
                    }}
                  >
                    {navigatingToDashboard ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        LOADING...
                      </>
                    ) : (
                      'OPEN DASHBOARD'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* COMMENTED OUT: Purchase flow modals and onboarding
      <OnboardingSection forceShow={forceShowOnboarding} onDismiss={() => setForceShowOnboarding(false)} />
      <FreeEligibilitySurveyModal
        isOpen={showFreeEligibilityModal}
        onOpenChange={setShowFreeEligibilityModal}
        onSurveyComplete={handleFreeEligibilitySurveyComplete}
      />
      */}

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
