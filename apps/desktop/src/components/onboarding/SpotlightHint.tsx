import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface SpotlightHintProps {
  children: React.ReactNode;
  tooltip: string;
  show: boolean;
  arrowPosition?: "top" | "bottom" | "auto";
  className?: string;
}

export function SpotlightHint({ children, tooltip, show, arrowPosition = "auto", className }: SpotlightHintProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [isElementVisible, setIsElementVisible] = useState(false);
  // Computed position when arrowPosition is "auto"
  const [computedPosition, setComputedPosition] = useState<"top" | "bottom">("top");
  // Arrow offset from center (when tooltip is shifted to stay in bounds)
  const [arrowOffset, setArrowOffset] = useState(0);

  // Check if element is actually visible (has dimensions) before showing overlay
  useEffect(() => {
    if (!show) {
      setIsElementVisible(false);
      return;
    }

    // Check after two frames to let children render and layout settle
    // Double RAF pattern ensures layout is complete before measuring
    const checkVisibility = () => {
      const container = containerRef.current;
      if (!container) {
        console.log("[SpotlightHint] Container not found, not showing overlay");
        setIsElementVisible(false);
        return;
      }

      const rect = container.getBoundingClientRect();
      const hasSize = rect.width > 0 && rect.height > 0;
      console.log("[SpotlightHint] Element visibility check:", { hasSize, width: rect.width, height: rect.height });
      setIsElementVisible(hasSize);
    };

    // Double RAF to ensure layout is settled after panel visibility changes
    requestAnimationFrame(() => {
      requestAnimationFrame(checkVisibility);
    });
  }, [show, children]);

  // Calculate tooltip position using fixed coordinates (for portal rendering)
  useEffect(() => {
    if (!show || !isElementVisible || !containerRef.current) return;

    const updatePosition = () => {
      const container = containerRef.current;
      const tooltip = tooltipRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const padding = 8; // Minimum padding from edge
      const gap = 16; // Gap between element and tooltip

      // Get actual tooltip dimensions (or use estimates on first render)
      const tooltipRect = tooltip?.getBoundingClientRect();
      const tooltipWidth = tooltipRect?.width || 200;
      const tooltipHeight = tooltipRect?.height || 60;

      // Calculate space available above and below
      const spaceAbove = containerRect.top - padding;
      const spaceBelow = windowHeight - containerRect.bottom - padding;
      const needsHeight = tooltipHeight + gap;

      // Determine position: prefer requested, but switch if not enough space
      let position: "top" | "bottom";
      if (arrowPosition === "auto") {
        // Auto: pick whichever side has more space
        position = spaceAbove >= spaceBelow ? "top" : "bottom";
      } else {
        // Explicit position: use it if fits, otherwise switch
        const fitsRequested = arrowPosition === "top" ? spaceAbove >= needsHeight : spaceBelow >= needsHeight;
        position = fitsRequested ? arrowPosition : arrowPosition === "top" ? "bottom" : "top";
      }
      setComputedPosition(position);

      // Calculate center X of the button (this is where arrow should point)
      const buttonCenterX = containerRect.left + containerRect.width / 2;

      // Calculate tooltip left position, clamped to viewport
      let left = buttonCenterX - tooltipWidth / 2;
      const minLeft = padding;
      const maxLeft = windowWidth - tooltipWidth - padding;
      const clampedLeft = Math.max(minLeft, Math.min(left, maxLeft));

      // Calculate arrow offset: how far from tooltip center the arrow should be
      // Arrow should point at buttonCenterX, which is at (buttonCenterX - clampedLeft) from tooltip left
      // Tooltip center is at tooltipWidth / 2, so offset = (buttonCenterX - clampedLeft) - tooltipWidth / 2
      const arrowOffsetPx = buttonCenterX - clampedLeft - tooltipWidth / 2;
      setArrowOffset(arrowOffsetPx);

      // Calculate top position (no clamping - we already picked the side with space)
      const top = position === "top" ? containerRect.top - tooltipHeight - gap : containerRect.bottom + gap;

      console.log("[SpotlightHint] Portal:", { left: clampedLeft, top, position, arrowOffsetPx, buttonCenterX });
      setTooltipStyle({ left: clampedLeft, top });
    };

    // Double RAF to ensure layout is settled after panel visibility changes
    // Then schedule another update after a short delay to catch tooltip dimensions
    let animFrame1: number;
    let animFrame2: number;
    let timeoutId: number;

    animFrame1 = requestAnimationFrame(() => {
      animFrame2 = requestAnimationFrame(() => {
        updatePosition();
        // Recalculate once more after tooltip renders to get actual dimensions
        timeoutId = window.setTimeout(updatePosition, 50);
      });
    });

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(animFrame1);
      cancelAnimationFrame(animFrame2);
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [show, isElementVisible, arrowPosition]);

  // When show=false, just render children without any wrapper
  if (!show) {
    return <>{children}</>;
  }

  // When show=true, always render container with ref so we can measure it
  // Only show overlay/tooltip once we've confirmed element is visible
  // Always use computedPosition - it reflects actual position after space checking
  // (arrowPosition prop is just a preference, computedPosition is the result)
  console.log(
    "[SpotlightHint] Rendering, isElementVisible:",
    isElementVisible,
    "tooltip:",
    tooltip,
    "computedPosition:",
    computedPosition
  );

  // Tooltip content rendered via portal
  // Use wrapper div for X offset (can't combine with animation transform)
  const tooltipContent = isElementVisible && (
    <div
      ref={tooltipRef}
      style={tooltipStyle}
      className="fixed flex flex-col items-center z-[9999] pointer-events-none"
    >
      {computedPosition === "top" ? (
        <>
          <div className="bg-black text-white text-xs font-mono px-3 py-2 rounded-md whitespace-nowrap shadow-lg">
            {tooltip}
          </div>
          {/* Wrapper for X offset, inner div for Y animation */}
          <div style={{ transform: `translateX(${arrowOffset}px)` }} className="mt-1">
            <div className="animate-bounce-arrow">
              <ChevronDown className="w-5 h-5 text-black" />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Wrapper for X offset, inner div for Y animation */}
          <div style={{ transform: `translateX(${arrowOffset}px)` }} className="mb-1">
            <div className="animate-bounce-arrow-up">
              <ChevronUp className="w-5 h-5 text-black" />
            </div>
          </div>
          <div className="bg-black text-white text-xs font-mono px-3 py-2 rounded-md whitespace-nowrap shadow-lg">
            {tooltip}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Blocking overlay - only show when element is visible, but leave title bar (h-8) accessible for window controls */}
      {isElementVisible && <div className="fixed top-8 left-0 right-0 bottom-0 z-40 bg-black/10" />}

      {/* Tooltip via portal - escapes overflow:hidden containers */}
      {tooltipContent && createPortal(tooltipContent, document.body)}

      <div ref={containerRef} className={cn("relative inline-flex", isElementVisible && "z-50", className)}>
        {/* Glowing wrapper - only animate when visible, with padding to prevent outline overflow */}
        <div className={cn("relative rounded-md", isElementVisible && "animate-glow-pulse p-[5px] -m-[5px]")}>
          {children}
        </div>

        {/* CSS for animations */}
        <style>{`
        @keyframes glow-pulse {
          0%, 100% {
            box-shadow: 0 0 0 2px black, 0 0 8px 2px rgba(0, 0, 0, 0.4);
          }
          50% {
            box-shadow: 0 0 0 3px black, 0 0 16px 4px rgba(0, 0, 0, 0.6);
          }
        }

        @keyframes bounce-arrow {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(6px);
          }
        }

        @keyframes bounce-arrow-up {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }

        .animate-glow-pulse {
          animation: glow-pulse 1.5s ease-in-out infinite;
        }

        .animate-bounce-arrow {
          animation: bounce-arrow 0.8s ease-in-out infinite;
        }

        .animate-bounce-arrow-up {
          animation: bounce-arrow-up 0.8s ease-in-out infinite;
        }
      `}</style>
      </div>
    </>
  );
}
