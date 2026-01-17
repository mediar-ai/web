import { ArrowUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface UpdateBadgeProps {
  currentVersion?: string;
  latestVersion?: string;
  className?: string;
  showText?: boolean; // Show "UPDATE" text or just dot
  onUpdate?: () => void; // Callback when badge is clicked to trigger update
  isUpdating?: boolean; // Show loading state while updating
}

/**
 * Compares two semver versions. Returns true if latest > current.
 * Simple comparison - handles common cases like "1.0.0" vs "1.1.0"
 */
function isNewerVersion(current: string, latest: string): boolean {
  // Normalize versions by removing 'v' prefix if present
  const normalize = (v: string) => v.replace(/^v/, "");
  const currentParts = normalize(current).split(".").map(Number);
  const latestParts = normalize(latest).split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const curr = currentParts[i] || 0;
    const lat = latestParts[i] || 0;
    if (lat > curr) return true;
    if (lat < curr) return false;
  }
  return false;
}

/**
 * Badge indicator showing when a workflow update is available.
 * Displays a small dot (or "UPDATE" text) when latestVersion > currentVersion.
 */
export function UpdateBadge({
  currentVersion,
  latestVersion,
  className,
  showText = false,
  onUpdate,
  isUpdating = false,
}: UpdateBadgeProps) {
  const [showSuccess, setShowSuccess] = useState(false);
  const [wasUpdating, setWasUpdating] = useState(false);

  // Track transition from updating to done for success animation
  useEffect(() => {
    if (isUpdating) {
      setWasUpdating(true);
    } else if (wasUpdating) {
      // Just finished updating - show success briefly
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
        setWasUpdating(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isUpdating, wasUpdating]);

  // Don't show if no version info available
  if (!currentVersion || !latestVersion) return null;

  // Don't show if already on latest (unless currently updating or showing success)
  if (!isUpdating && !showSuccess && !isNewerVersion(currentVersion, latestVersion)) return null;

  // Show success state after update completes
  if (showSuccess) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center",
          "w-4 h-4 rounded-full",
          "bg-green-500",
          "animate-in zoom-in-50 duration-200",
          className
        )}
        title="Updated!"
      >
        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
      </span>
    );
  }

  // Show updating state - minimal spinning dot
  if (isUpdating) {
    return (
      <span className={cn("relative inline-flex items-center justify-center w-4 h-4", className)} title="Updating...">
        {/* Spinning ring */}
        <span className="absolute inset-0 rounded-full border-2 border-gray-200" />
        <span
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-black animate-spin"
          style={{ animationDuration: "0.6s" }}
        />
        {/* Center dot */}
        <span className="w-1.5 h-1.5 rounded-full bg-black" />
      </span>
    );
  }

  const tooltipText = onUpdate
    ? `v${currentVersion} → v${latestVersion} (click to update)`
    : `Update available: v${currentVersion} → v${latestVersion}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate?.();
  };

  if (showText) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5",
          "font-mono text-[9px] font-bold",
          "text-black bg-white border border-black",
          "px-1 py-0.5 rounded",
          onUpdate && "cursor-pointer hover:bg-black hover:text-white transition-colors",
          className
        )}
        title={tooltipText}
        onClick={onUpdate ? handleClick : undefined}
      >
        <ArrowUp className="w-2.5 h-2.5" />
        UPDATE
      </span>
    );
  }

  // Dot-only variant (default)
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        "bg-black",
        "animate-pulse",
        onUpdate && "cursor-pointer hover:scale-125 transition-transform",
        className
      )}
      title={tooltipText}
      onClick={onUpdate ? handleClick : undefined}
    />
  );
}

/**
 * Hook to check if a workflow has an available update
 */
export function hasWorkflowUpdate(currentVersion?: string, latestVersion?: string): boolean {
  if (!currentVersion || !latestVersion) return false;
  return isNewerVersion(currentVersion, latestVersion);
}
