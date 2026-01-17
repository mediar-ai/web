import { AlertTriangle, Loader2, LogIn, Mail, Copy, Check, ShieldOff, ShieldAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const SUPPORT_EMAIL = "matt@mediar.ai";

interface LoginPromptProps {
  onLogin: () => Promise<void>;
  isLoading?: boolean;
  isPolling?: boolean;
  error?: string | null;
}

export function LoginPrompt({ onLogin, isLoading, isPolling, error }: LoginPromptProps) {
  const [copied, setCopied] = useState(false);

  const handleLogin = async () => {
    try {
      await onLogin();
    } catch (err) {
      // Error is handled by useAuth hook
      console.error("Login failed:", err);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = SUPPORT_EMAIL;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Check if this is a trial/blocked error
  const isBlockedError =
    error &&
    (error.toLowerCase().includes("trial") ||
      error.toLowerCase().includes("expired") ||
      error.toLowerCase().includes("suspended") ||
      error.toLowerCase().includes("blocked"));

  // Determine if trial expired or suspended
  const isTrialExpired = error && (error.toLowerCase().includes("trial") || error.toLowerCase().includes("expired"));

  // Show blocked page matching web app design
  if (isBlockedError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-black text-white flex items-center justify-center">
              {isTrialExpired ? <ShieldOff className="w-10 h-10" /> : <ShieldAlert className="w-10 h-10" />}
            </div>
          </div>

          {/* Title */}
          <h1 className="font-mono font-bold text-2xl text-center mb-4">
            {isTrialExpired ? "TRIAL ENDED" : "ACCOUNT SUSPENDED"}
          </h1>

          {/* Message */}
          <div className="border-2 border-black p-6 mb-6">
            <p className="font-mono text-sm text-center text-gray-700">
              {error ||
                (isTrialExpired
                  ? "Your trial period has ended. Please contact us to upgrade your account."
                  : "Your account has been suspended. Please contact support for assistance.")}
            </p>
          </div>

          {/* Contact Email */}
          <div className="mb-6">
            <p className="font-mono text-xs text-gray-600 text-center mb-2 uppercase">
              {isTrialExpired ? "Contact us to upgrade" : "Contact support"}
            </p>
            <div className="flex items-center gap-2 border-2 border-black p-3">
              <Mail className="w-4 h-4 flex-shrink-0" />
              <span className="font-mono text-sm flex-1">{SUPPORT_EMAIL}</span>
              <button
                onClick={copyEmail}
                className="flex items-center gap-1 px-2 py-1 font-mono text-xs font-bold border border-black hover:bg-black hover:text-white transition-colors"
                title="Copy email"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3" />
                    COPIED
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    COPY
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${isTrialExpired ? "Trial%20Upgrade%20Request" : "Account%20Suspended%20-%20Help%20Request"}`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-black text-white hover:bg-gray-800 transition-colors"
            >
              <Mail className="w-4 h-4" />
              OPEN EMAIL CLIENT
            </a>

            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 font-mono text-sm font-bold border-2 border-black bg-white text-black hover:bg-black hover:text-white transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              TRY DIFFERENT ACCOUNT
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Normal login prompt
  return (
    <div className="min-h-screen flex items-center justify-center bg-white/5 backdrop-blur-md p-4">
      <div className="max-w-md w-full bg-white/5 backdrop-blur-md border border-black rounded-lg shadow-sm p-8">
        <div className="text-center mb-6">
          {/* Using actual app icon */}
          <div className="w-16 h-16 mx-auto mb-4">
            <img src="/icon-128.png" alt="Mediar" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Mediar</h1>
          <p className="text-sm text-gray-700">
            {isPolling ? "Waiting for authentication in browser..." : "Sign in to continue using the desktop app"}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-white/5 backdrop-blur-md border-2 border-black rounded-lg">
            <div className="flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-600 font-medium text-center">{error}</p>
            </div>
          </div>
        )}

        <Button onClick={handleLogin} disabled={isLoading || isPolling} className="w-full h-10 font-medium">
          {isPolling ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Waiting for authentication...
            </>
          ) : isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Opening browser...
            </>
          ) : (
            <>
              <LogIn className="mr-2 h-4 w-4" />
              Sign In with Browser
            </>
          )}
        </Button>

        <div className="mt-4 text-center text-xs text-gray-600">
          <p>
            {isPolling ? (
              <>
                Complete the authentication in your browser.
                <br />
                This window will update automatically once you sign in.
              </>
            ) : (
              <>
                Your browser will open for secure authentication.
                <br />
                You&apos;ll be redirected back to the app after signing in.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
