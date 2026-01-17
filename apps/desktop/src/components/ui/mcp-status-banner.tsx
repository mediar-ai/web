import { AlertCircle, X, RotateCw, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./button";

interface McpStatusBannerProps {
  isHealthy: boolean;
  isInitializing: boolean;
  error: string | null;
  onRefresh?: () => void | Promise<void>;
  onRestart?: () => void | Promise<void>;
  onDismiss?: () => void;
  variant?: "fixed" | "inline";
}

/**
 * Prominent MCP status notification banner
 * Can be used as a fixed banner at top of screen or inline within content
 * Black/white design matching app style with black outline
 */
export function McpStatusBanner({
  isHealthy,
  isInitializing,
  error,
  onRefresh,
  onRestart,
  onDismiss,
  variant = "fixed",
}: McpStatusBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  // Reset dismissed state when connection is restored
  useEffect(() => {
    if (isHealthy) {
      setIsDismissed(false);
      setShowBanner(false);
      setIsRestarting(false); // Clear restart loading state on recovery
    }
  }, [isHealthy]);

  // Show banner when MCP becomes unhealthy
  // - Show immediately when initializing (restart in progress)
  // - Use 2-second delay for non-restart failures (avoid flashing on quick reconnects)
  useEffect(() => {
    if (!isHealthy) {
      if (isInitializing) {
        // Show immediately during restart
        setShowBanner(true);
        return; // Return early, no cleanup needed
      } else {
        // Use delay for connection failures to avoid flashing
        const timer = setTimeout(() => {
          setShowBanner(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    } else {
      setShowBanner(false);
    }
  }, [isHealthy, isInitializing]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setShowBanner(false);
    onDismiss?.();
  };

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRestart = async () => {
    if (!onRestart || isRestarting) return;
    setIsRestarting(true);
    try {
      await onRestart();
    } finally {
      // Keep loading state for a bit longer to show feedback
      setTimeout(() => setIsRestarting(false), 2000);
    }
  };

  // Don't show banner if:
  // - User dismissed it
  // - MCP is healthy
  // - For fixed variant: banner hasn't been triggered to show yet (2 second delay)
  //   UNLESS isInitializing is true (show immediately during restarts)
  if (isHealthy || isDismissed || (variant === "fixed" && !showBanner && !isInitializing)) {
    return null;
  }

  const containerClass =
    variant === "fixed"
      ? "fixed top-10 left-0 right-0 z-[9999] animate-in slide-in-from-top duration-300 pointer-events-none"
      : "w-full";

  const innerClass =
    variant === "fixed"
      ? "bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] mx-4 pointer-events-auto"
      : "bg-white/5 backdrop-blur-md border-2 border-black rounded-lg";

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        <div className="flex items-start gap-3 p-4">
          {/* Icon */}
          <div className="flex-shrink-0 pt-0.5">
            <AlertCircle className="h-5 w-5 text-black" strokeWidth={2} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-black mb-1">Workflow Automation Disconnected</h3>
              <p className="text-xs text-black/70 leading-relaxed">Connection lost - MCP server not responding</p>
            </div>

            {/* Restart Button inline with content */}
            {onRestart && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestart}
                disabled={isRestarting || isInitializing}
                className="h-8 px-3 text-xs font-medium flex-shrink-0"
              >
                {isRestarting || isInitializing ? (
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" strokeWidth={2} />
                ) : (
                  <RotateCw className="h-3 w-3 mr-1.5" strokeWidth={2} />
                )}
                {isInitializing ? "Restarting..." : "Restart"}
              </Button>
            )}
          </div>

          {/* Dismiss Button */}
          {variant === "fixed" && (
            <div className="flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={handleDismiss} className="h-8 w-8 p-0">
                <X className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
