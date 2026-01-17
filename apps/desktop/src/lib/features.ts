// Feature detection utility for the overlay-focused app
import { invoke } from "@tauri-apps/api/core";

export type AppVariant = "overlay" | "service";

export interface FeatureFlags {
  overlay: boolean;
  workflowRecording: boolean;
  analytics: boolean;
  trayIcon: boolean;
}

// Extended remote feature flags from PostHog
export interface RemoteFeatureFlags {
  // Core features
  workflow_recording_enabled: boolean;
  chat_ui_enabled: boolean;
  tray_only_mode: boolean;

  // Additional features
  analytics_enabled: boolean;
  form_filling_enabled: boolean;
  remote_dashboard_enabled: boolean;
  low_energy_mode: boolean;

  // Advanced features
  auto_screenshot_enabled: boolean;
  smart_triggers_enabled: boolean;
  background_processing: boolean;
}

export const APP_VARIANT: AppVariant = (process.env.VITE_APP_VARIANT as AppVariant) || "overlay";
export const APP_NAME: string = process.env.VITE_APP_NAME || "Mediar";

// Build-time features (fallback)
export const FEATURES: FeatureFlags = {
  overlay: getFeature("overlay"),
  workflowRecording: getFeature("workflow-recording"),
  analytics: getFeature("analytics"),
  trayIcon: getFeature("tray-icon"),
};

function getFeature(feature: string): boolean {
  const features = process.env.VITE_FEATURES || "";
  return features.split(",").includes(feature);
}

export const getAppConfig = () => ({
  variant: APP_VARIANT,
  name: APP_NAME,
  features: FEATURES,
});

// Helper functions for conditional rendering (build-time)
export const isOverlayApp = () => APP_VARIANT === "overlay";
export const hasWorkflowRecording = () => FEATURES.workflowRecording;

// Remote feature flag management
let remoteFeatures: RemoteFeatureFlags | null = null;
let lastFetch: number | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch remote feature flags from PostHog via Tauri
 * Cached for 5 minutes to avoid excessive API calls
 */
async function getRemoteFeatures(): Promise<RemoteFeatureFlags> {
  const now = Date.now();

  // Return cached features if still valid
  if (remoteFeatures && lastFetch && now - lastFetch < CACHE_DURATION) {
    return remoteFeatures;
  }

  try {
    const features = await invoke<RemoteFeatureFlags>("get_remote_features");
    remoteFeatures = features;
    lastFetch = now;
    return features;
  } catch (error) {
    console.warn("⚠️ Failed to fetch remote features, using defaults:", error);

    // Return sensible defaults if PostHog is unavailable
    const defaultFeatures: RemoteFeatureFlags = {
      workflow_recording_enabled: true,
      chat_ui_enabled: true,
      tray_only_mode: false,
      analytics_enabled: true,
      form_filling_enabled: true,
      remote_dashboard_enabled: false,
      low_energy_mode: false,
      auto_screenshot_enabled: true,
      smart_triggers_enabled: true,
      background_processing: true,
    };

    remoteFeatures = defaultFeatures;
    lastFetch = now;

    return defaultFeatures;
  }
}

export async function shouldShowChatUI(): Promise<boolean> {
  const remoteFlags = await getRemoteFeatures();
  // If remote flag enables tray-only mode, hide chat UI
  if (remoteFlags.tray_only_mode) {
    return false;
  }
  return remoteFlags.chat_ui_enabled;
}

/**
 * Get app mode based on remote feature flags
 * Returns 'tray-only', 'full-ui', or 'service'
 */
export async function getAppMode(): Promise<"tray-only" | "full-ui" | "service"> {
  if (APP_VARIANT === "service") {
    return "service";
  }

  const remoteFlags = await getRemoteFeatures();

  if (remoteFlags.tray_only_mode) {
    return "tray-only";
  }

  return "full-ui";
}
