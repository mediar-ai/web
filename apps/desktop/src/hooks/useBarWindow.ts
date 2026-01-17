import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";

/**
 * Shared hook for bar component window visibility tracking.
 * Polls window visibility and calls onBecameVisible when window transitions from hidden to visible.
 *
 * @param onBecameVisible - Callback fired when window becomes visible (was hidden, now visible)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 100)
 */
export function useBarWindow(onBecameVisible: () => void, pollIntervalMs: number = 100): void {
  const onBecameVisibleRef = useRef(onBecameVisible);

  // Keep callback ref up to date without triggering effect re-runs
  useEffect(() => {
    onBecameVisibleRef.current = onBecameVisible;
  }, [onBecameVisible]);

  useEffect(() => {
    console.log("[useBarWindow] Setting up visibility polling");
    let intervalId: NodeJS.Timeout | null = null;
    let wasVisible = false;

    const setupVisibilityListener = async () => {
      const window = getCurrentWindow();
      wasVisible = await window.isVisible();

      intervalId = setInterval(async () => {
        const isVisible = await window.isVisible();

        // Window just became visible (was hidden, now visible)
        if (isVisible && !wasVisible) {
          console.log("[useBarWindow] Window became visible");
          onBecameVisibleRef.current();
        }

        wasVisible = isVisible;
      }, pollIntervalMs);
    };

    setupVisibilityListener();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [pollIntervalMs]);
}
