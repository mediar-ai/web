import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState, useCallback, useEffect } from "react";

// Predefined window sizes for different view modes
export const WINDOW_SIZES = {
  normal: { width: 1280, height: 800 },
  compact: { width: 380, height: 600 }, // Even more compact for release
} as const;

export interface CompactViewSettings {
  isCompact: boolean;
}

/**
 * Hook to manage compact view state and apply window/font changes
 * Handles both window resizing via Tauri APIs and font scaling via CSS classes
 */
export function useCompactView() {
  const [isCompact, setIsCompact] = useState(true); // Default to compact view
  const [isLoading, setIsLoading] = useState(false);

  // Load initial compact view state from settings
  useEffect(() => {
    async function loadCompactViewState() {
      try {
        const settings = await invoke<{ compact_view: boolean }>("get_settings");
        const shouldBeCompact = settings.compact_view;

        if (shouldBeCompact) {
          // Apply compact view classes without resizing window (already set by backend)
          document.documentElement.classList.add("compact-view");
          setIsCompact(true);
        }
      } catch (error) {
        console.warn("Failed to load compact view state:", error);
      }
    }

    loadCompactViewState();
  }, []);

  /**
   * Apply compact view changes including window resize and font scaling
   * @param compact - Whether to enable compact view
   */
  const applyCompactView = useCallback(
    async (compact: boolean) => {
      console.log(`🎯 applyCompactView called with: ${compact}, isLoading: ${isLoading}`);
      if (isLoading) {
        console.log(`⏸️ Already loading, skipping`);
        return;
      }

      setIsLoading(true);

      try {
        // Get current window instance
        const appWindow = getCurrentWindow();
        const targetSize = compact ? WINDOW_SIZES.compact : WINDOW_SIZES.normal;

        console.log(`📐 Target size: ${targetSize.width}x${targetSize.height}`);

        // Resize window with smooth transition
        await appWindow.setSize(new LogicalSize(targetSize.width, targetSize.height));

        // Apply or remove compact view CSS classes
        if (compact) {
          document.documentElement.classList.add("compact-view");
          console.log(`✅ Added 'compact-view' class`);
        } else {
          document.documentElement.classList.remove("compact-view");
          console.log(`✅ Removed 'compact-view' class`);
        }

        // Update state
        setIsCompact(compact);

        // Persist setting to backend (note: this might be redundant since SettingsPage already calls update_s)
        // await invoke('update_s', {
        //   key: 'compact_view',
        //   value: compact
        // });

        console.log(`✅ Applied ${compact ? "compact" : "normal"} view: ${targetSize.width}x${targetSize.height}`);
      } catch (error) {
        console.error("❌ Failed to apply compact view:", error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading]
  );

  /**
   * Toggle between compact and normal view
   */
  const toggleCompactView = useCallback(async () => {
    await applyCompactView(!isCompact);
  }, [isCompact, applyCompactView]);

  return {
    isCompact,
    isLoading,
    applyCompactView,
    toggleCompactView,
    windowSizes: WINDOW_SIZES,
  };
}
