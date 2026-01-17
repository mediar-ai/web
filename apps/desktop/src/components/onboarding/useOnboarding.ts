import { useState, useEffect } from "react";
import { trackOnboardingCompleted } from "@/lib/analytics";

// Tutorial steps:
// 1 = Show "Cards" button hint (list view)
// 2 = Show "List" button hint (card view)
// 3 = Show workflow row hint to download (list view)
// 4 = Show workflow row hint to open (after download)
// 5 = Show "Explain workflow" quick action hint (prefills input)
// 6 = Show "Send" button hint (submits, waits for AI)
// 7 = Show "Run All" button hint
// 8 = Show "Back" button hint to return to workflow list
// 9 = Show "New Chat" button hint
// 10 = Auto-type "open chrome" + show "Send" button hint (waits for AI)
// 11 = Show "Arrange Windows" button hint
// 12 = Show "Demo: Search Mediar" quick action hint (prefills input)
// 13 = Show "Send" button hint (submits, waits for AI response)
// 14 = After AI responds, spotlight "Workflows" button (user must click)
// 15 = After clicking Workflows, switch to Workflows panel, spotlight "New Workflow" button
// 16 = After clicking New Workflow, auto-fill name, spotlight Create button
// 17 = After clicking Create, wait for workflow creation + deps install
// 18 = Show demo explanation modal, wait for user OK
// 19 = Auto-start recording, execute demo workflow, auto-stop, wait for AI post-processing
// 20 = Wait for AI post-processing to complete, then mark tutorial done
type TutorialStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | "done";

// The workflow all new users must run to enable the Chrome/Edge extension
export const ONBOARDING_WORKFLOW_UUID = "593a77b5-9245-46bc-90c9-5f49f257851f";

// Demo workflow (Greenway) for instant onboarding demo
export const DEMO_WORKFLOW_UUID = "b453736d-ba19-42ea-a54a-c8be1ec284fe";

// Recording demo workflow - demonstrates browser automation by logging into a practice website
export const RECORDING_DEMO_WORKFLOW_UUID = "1f9ae4aa-b5da-4474-9e65-8a44690dc028";

interface OnboardingState {
  hasCompletedFirstRecording: boolean;
  firstRecordingTimestamp?: number;
  hasRunFirstWorkflow?: boolean;
  hasScheduledCall?: boolean;
  hasDeclinedOnboarding?: boolean; // User clicked "Skip" on booking modal
  tutorialStep?: TutorialStep;
}

const ONBOARDING_STORAGE_KEY = "mediar_onboarding_state";

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(() => {
    const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return { hasCompletedFirstRecording: false };
      }
    }
    return { hasCompletedFirstRecording: false };
  });

  // No longer show welcome modal automatically - it's now opt-in via "Book onboarding" button
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  // New: modal for booking that can be opened/closed by user
  const [showOnboardingBooking, setShowOnboardingBooking] = useState(false);

  useEffect(() => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Auto-start tutorial for new users (no longer requires Cal.com booking first)
  useEffect(() => {
    if (!state.hasCompletedFirstRecording && state.tutorialStep === undefined) {
      console.log("[Onboarding] New user detected, auto-starting tutorial from step 1");
      setState(prev => ({
        ...prev,
        tutorialStep: 1,
      }));
    }
  }, [state.hasCompletedFirstRecording, state.tutorialStep]);

  const completeFirstRecording = () => {
    setState({
      ...state,
      hasCompletedFirstRecording: true,
      firstRecordingTimestamp: Date.now(),
    });
    setShowSuccessModal(true);
  };

  const completeFirstRun = () => {
    setState({
      ...state,
      hasRunFirstWorkflow: true,
    });
  };

  const completeCalBooking = () => {
    console.log("[Onboarding] Cal.com booking completed");
    setState({
      ...state,
      hasScheduledCall: true,
    });
  };

  const skipWelcome = () => {
    // Mark as completed and skip entire tutorial (dev mode skip)
    console.log("[Onboarding] skipWelcome - skipping entire onboarding");
    setState({
      ...state,
      hasCompletedFirstRecording: true,
      firstRecordingTimestamp: Date.now(),
      tutorialStep: "done", // Skip tutorial entirely
    });
    setShowWelcomeModal(false);
  };

  const startTutorial = () => {
    // Mark as completed and START the tutorial (normal completion)
    console.log("[Onboarding] startTutorial - starting tutorial from step 1");
    setState({
      ...state,
      hasCompletedFirstRecording: true,
      firstRecordingTimestamp: Date.now(),
      tutorialStep: 1, // Start with step 1: show Cards hint
    });
    setShowWelcomeModal(false);
  };

  const advanceTutorial = () => {
    setState(prevState => {
      const currentStep = prevState.tutorialStep;
      console.log("[Onboarding] advanceTutorial, current step:", currentStep);
      if (typeof currentStep === "number" && currentStep < 20) {
        return {
          ...prevState,
          tutorialStep: (currentStep + 1) as TutorialStep,
        };
      } else if (currentStep === 20) {
        console.log("[Onboarding] Tutorial completed!");
        trackOnboardingCompleted();
        return {
          ...prevState,
          tutorialStep: "done",
        };
      }
      return prevState;
    });
  };

  const goBackTutorial = () => {
    setState(prevState => {
      const currentStep = prevState.tutorialStep;
      console.log("[Onboarding] goBackTutorial, current step:", currentStep);
      if (typeof currentStep === "number" && currentStep > 1) {
        return {
          ...prevState,
          tutorialStep: (currentStep - 1) as TutorialStep,
        };
      }
      return prevState;
    });
  };

  const closeSuccessModal = () => {
    setShowSuccessModal(false);
  };

  // New: open the booking modal from the top bar button
  const openOnboardingBooking = () => {
    console.log("[Onboarding] Opening booking modal");
    setShowOnboardingBooking(true);
  };

  // New: close the booking modal without declining
  const closeOnboardingBooking = () => {
    console.log("[Onboarding] Closing booking modal");
    setShowOnboardingBooking(false);
  };

  // New: decline onboarding - hides the button permanently
  const declineOnboarding = () => {
    console.log("[Onboarding] User declined onboarding booking");
    setState({
      ...state,
      hasDeclinedOnboarding: true,
    });
    setShowOnboardingBooking(false);
  };

  const resetOnboarding = () => {
    setState({
      hasCompletedFirstRecording: false,
      firstRecordingTimestamp: undefined,
      hasRunFirstWorkflow: false,
      hasDeclinedOnboarding: false,
      hasScheduledCall: false,
      tutorialStep: undefined,
    });
    setShowWelcomeModal(false);
    setShowSuccessModal(false);
    setShowOnboardingBooking(false);
  };

  // Check if user is existing (already completed onboarding before) - they skip Cal step
  const isExistingUser = state.hasCompletedFirstRecording && !state.hasScheduledCall;

  // Tutorial step state
  const tutorialStep = state.tutorialStep;

  // Show "Book onboarding" button if user hasn't booked AND hasn't declined
  const showOnboardingButton = !state.hasScheduledCall && !state.hasDeclinedOnboarding;

  return {
    state,
    showWelcomeModal,
    showSuccessModal,
    showOnboardingBooking,
    showOnboardingButton,
    isExistingUser,
    tutorialStep,
    completeFirstRecording,
    completeFirstRun,
    completeCalBooking,
    skipWelcome,
    startTutorial,
    advanceTutorial,
    goBackTutorial,
    closeSuccessModal,
    openOnboardingBooking,
    closeOnboardingBooking,
    declineOnboarding,
    resetOnboarding,
  };
}
