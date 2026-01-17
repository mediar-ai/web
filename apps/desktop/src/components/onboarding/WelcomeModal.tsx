import { Check, Calendar, ExternalLink, Loader2, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { API_BASE_URL } from "@/config/api";
import { getAuthToken } from "@/services/vertex-http-client";

const CAL_BOOKING_URL = "https://cal.com/team/mediar/onboarding";
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds

// Cal.com booking component - opens in system browser and polls for confirmation
function CalBookingSection({
  onBookingComplete,
  userEmail,
  userId,
}: {
  onBookingComplete: () => void;
  userEmail?: string;
  userId?: string;
}) {
  const [hasOpened, setHasOpened] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onBookingCompleteRef = useRef(onBookingComplete);
  onBookingCompleteRef.current = onBookingComplete;

  // Check if user has booked via webhook
  const checkBookingStatus = async () => {
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        console.log("[CalBooking] No auth token, skipping poll");
        return false;
      }

      const response = await fetch(`${API_BASE_URL}/api/user/cal-booking`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        console.warn("[CalBooking] Poll failed:", response.status);
        return false;
      }

      const data = await response.json();
      console.log("[CalBooking] Poll result:", data);

      if (data.bookedCalCall) {
        console.log("[CalBooking] Booking confirmed via webhook!");
        return true;
      }
      return false;
    } catch (error) {
      console.error("[CalBooking] Poll error:", error);
      return false;
    }
  };

  // Start polling when Cal.com is opened
  useEffect(() => {
    if (hasOpened && !bookingConfirmed) {
      console.log("[CalBooking] Starting poll for booking confirmation");
      setIsPolling(true);

      const poll = async () => {
        const confirmed = await checkBookingStatus();
        if (confirmed) {
          setBookingConfirmed(true);
          setIsPolling(false);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          // Auto-advance after short delay
          setTimeout(() => {
            onBookingCompleteRef.current();
          }, 500);
        }
      };

      // Initial check
      poll();

      // Set up interval
      pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }
  }, [hasOpened, bookingConfirmed]);

  const handleOpenCalendar = async () => {
    console.log("[CalBooking] Opening Cal.com in browser");

    // Build URL with prefilled email (editable) and user_id (locked/hidden)
    const params = new URLSearchParams();
    if (userEmail) {
      params.append("email", userEmail);
      console.log("[CalBooking] Pre-filling email:", userEmail);
    }
    if (userId) {
      params.append("user_id", userId);
      console.log("[CalBooking] Pre-filling user_id (hidden):", userId);
    }

    const calUrl = params.toString() ? `${CAL_BOOKING_URL}?${params.toString()}` : CAL_BOOKING_URL;

    try {
      await invoke("open_url_in_browser", { url: calUrl });
      setHasOpened(true);
      console.log("[CalBooking] Cal.com opened successfully with prefilled fields");
    } catch (error) {
      console.error("[CalBooking] Failed to open Cal.com:", error);
      // Fallback: try window.open
      window.open(calUrl, "_blank");
      setHasOpened(true);
    }
  };

  return (
    <div className="w-full border-2 border-black rounded-lg p-6 bg-gray-50">
      <div className="text-center space-y-4">
        <p className="text-sm text-gray-600">Click below to open our scheduling page in your browser</p>

        <button
          onClick={handleOpenCalendar}
          className="inline-flex items-center gap-2 px-6 py-3 bg-black text-white rounded-md font-mono text-sm hover:bg-gray-800 transition-colors"
        >
          <Calendar className="w-4 h-4" />
          Open Scheduling Page
          <ExternalLink className="w-4 h-4" />
        </button>

        {hasOpened && !bookingConfirmed && isPolling && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Waiting for booking confirmation...
            </div>
          </div>
        )}

        {bookingConfirmed && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <div className="flex items-center justify-center gap-2 text-sm text-green-600">
              <Check className="w-4 h-4" />
              Booking confirmed! Continuing...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface WelcomeModalProps {
  open: boolean;
  onCalBookingComplete: () => void;
  onDecline: () => void; // Hide the button permanently
  onClose: () => void; // Just close the modal without hiding button
  userEmail?: string;
  userId?: string;
}

// Single step: Cal Booking only - webhook confirms booking and closes modal
const ONBOARDING_STEP = {
  title: "Schedule Your Onboarding",
  description: "Book a quick call with our team to get personalized help setting up your first automation.",
  icon: <Calendar className="w-6 h-6" />,
};

export function WelcomeModal({ open, onCalBookingComplete, onDecline, onClose, userEmail, userId }: WelcomeModalProps) {
  console.log("[Onboarding] WelcomeModal render, open:", open, "userEmail:", userEmail, "userId:", userId);

  // ESC key to close the modal
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        console.log("[Onboarding] ESC pressed, closing modal");
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const handleCalBookingComplete = () => {
    console.log("[Onboarding] Cal booking complete, finishing onboarding");
    onCalBookingComplete();
    onClose(); // Close modal immediately after booking confirmed
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal content */}
      <div
        className={cn(
          "relative bg-white border-2 border-black rounded-lg shadow-xl",
          "w-full max-w-2xl mx-4",
          "max-h-[90vh]",
          "overflow-hidden",
          "animate-in fade-in-0 zoom-in-95 duration-300",
          "flex flex-col"
        )}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-black text-white flex items-center justify-center flex-shrink-0">
              {ONBOARDING_STEP.icon}
            </div>
            <h2 className="text-xl font-mono font-bold text-black">{ONBOARDING_STEP.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          <p className="text-gray-600 text-sm leading-relaxed mb-6">{ONBOARDING_STEP.description}</p>

          <CalBookingSection onBookingComplete={handleCalBookingComplete} userEmail={userEmail} userId={userId} />
        </div>

        {/* Footer with skip button */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
          <button
            onClick={onDecline}
            className="text-sm text-gray-500 hover:text-black transition-colors font-mono underline"
          >
            Don&apos;t show again
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-mono text-gray-600 hover:text-black transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
