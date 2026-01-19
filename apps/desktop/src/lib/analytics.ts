import { invoke } from "@tauri-apps/api/core";
import posthog from "posthog-js";

// PostHog configuration - loaded from environment variable with fallback
const POSTHOG_API_KEY = import.meta.env.VITE_POSTHOG_API_KEY || "phc_NFSaZUao49XckpqaeyB3lIEKrFXhhXbKaI81jqZ8yn9";
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";

let isInitialized = false;
let machineId: string | null = null;

/**
 * Initialize PostHog analytics with machine ID from Tauri backend
 */
export async function initializeAnalytics(): Promise<void> {
  if (isInitialized) {
    console.log("✅ [Analytics] Already initialized");
    return;
  }

  try {
    // Get machine ID from Tauri backend
    machineId = await invoke<string>("get_machine_id_command");
    console.log("🔐 [Analytics] Machine ID retrieved:", machineId);

    // Initialize PostHog - anonymous until user authenticates
    // identifyUser() will call alias() + identify() to merge machine_id → user_id
    posthog.init(POSTHOG_API_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only", // Only create profiles for identified users
      capture_pageview: false, // We'll manually track views
      capture_pageleave: false,
      autocapture: false, // Disable autocapture for now, we'll track manually
      disable_session_recording: false, // Enable session recording
      loaded: ph => {
        console.log("✅ [Analytics] PostHog initialized with machine ID as distinct_id (anonymous)");
      },
    });

    isInitialized = true;
  } catch (error) {
    console.error("❌ [Analytics] Failed to initialize:", error);
    throw error;
  }
}

/**
 * Identify user after authentication (merges machine ID with user ID)
 */
export function identifyUser(userId: string, email: string): void {
  if (!isInitialized) {
    console.warn("⚠️ [Analytics] Not initialized, cannot identify user");
    return;
  }

  const currentDistinctId = posthog.get_distinct_id();

  // Alias machine_id → userId to link previous anonymous events
  if (currentDistinctId && currentDistinctId !== userId) {
    console.log(`🔗 [Analytics] Aliasing ${currentDistinctId} → ${userId}`);
    posthog.alias(userId, currentDistinctId);
  }

  // Identify with user properties
  posthog.identify(userId, {
    email,
    machine_id: machineId,
  });

  console.log("✅ [Analytics] User identified in PostHog");
}

/**
 * Track a custom event with properties
 */
function trackEvent(eventName: string, properties?: Record<string, any>): void {
  if (!isInitialized) {
    console.warn("⚠️ [Analytics] Not initialized, cannot track event:", eventName);
    return;
  }

  const eventProperties = {
    ...properties,
    source: "frontend",
    platform: "desktop",
  };

  posthog.capture(eventName, eventProperties);
  console.log(`📊 [Analytics] Event tracked: ${eventName}`, eventProperties);
}

// ========================================
// AUTHENTICATION EVENTS
// ========================================

export function trackLoginInitiated(): void {
  trackEvent("desktop_login_initiated");
}

export function trackLoginSuccess(userId: string, email: string): void {
  trackEvent("desktop_login_success", {
    user_id: userId,
    email,
  });
}

export function trackLogout(): void {
  trackEvent("desktop_logout");
}

// ========================================
// WORKFLOW EVENTS
// ========================================

export function trackWorkflowOpened(workflowId: string, workflowName: string): void {
  trackEvent("desktop_workflow_opened", {
    workflow_id: workflowId,
    workflow_name: workflowName,
  });
}

export function trackRunWorkflowButton(
  workflowId: string,
  workflowName: string,
  source: "button" | "keyboard_shortcut",
  executionType: "full" | "single_step",
  stepIndex?: number,
  stepId?: string
): void {
  trackEvent("desktop_run_workflow_button", {
    workflow_id: workflowId,
    workflow_name: workflowName,
    source,
    execution_type: executionType,
    step_index: stepIndex,
    step_id: stepId,
  });
}

export function trackWorkflowStarted(
  workflowId: string,
  workflowName: string,
  source: "manual" | "keyboard_shortcut"
): void {
  trackEvent("desktop_workflow_started", {
    workflow_id: workflowId,
    workflow_name: workflowName,
    source,
  });
}

export function trackWorkflowStepExecuted(
  workflowId: string,
  stepId: string,
  stepType: string,
  stepIndex: number
): void {
  trackEvent("desktop_workflow_step_executed", {
    workflow_id: workflowId,
    step_id: stepId,
    step_type: stepType,
    step_index: stepIndex,
  });
}

export function trackWorkflowStopped(
  workflowId: string,
  workflowName: string,
  currentStep: number,
  totalSteps: number
): void {
  trackEvent("desktop_workflow_stopped", {
    workflow_id: workflowId,
    workflow_name: workflowName,
    current_step: currentStep,
    total_steps: totalSteps,
  });
}

// ========================================
// RECORDING EVENTS
// ========================================

export function trackRecordingStarted(source: "manual" | "workflow"): void {
  trackEvent("desktop_recording_started", {
    source,
  });
}

export function trackRecordingStopped(duration?: number): void {
  trackEvent("desktop_recording_stopped", {
    duration_ms: duration,
  });
}

// ========================================
// CHAT EVENTS
// ========================================

export function trackChatMessageSent(messageType: "user" | "correction", hasContext: boolean): void {
  trackEvent("desktop_chat_message_sent", {
    message_type: messageType,
    has_context: hasContext,
  });
}

// ========================================
// NAVIGATION EVENTS
// ========================================

export function trackSettingsOpened(): void {
  trackEvent("desktop_settings_opened");
}

export function trackBackButtonClicked(currentView: string): void {
  trackEvent("desktop_back_button_clicked", {
    current_view: currentView,
  });
}

export function trackNewChatStarted(): void {
  trackEvent("desktop_new_chat_started");
}

export function trackWorkflowsFolderOpened(): void {
  trackEvent("desktop_workflows_folder_opened");
}

// ========================================
// SETTINGS EVENTS
// ========================================

export function trackSettingChanged(settingKey: string, newValue: any): void {
  trackEvent("desktop_setting_changed", {
    setting_key: settingKey,
    new_value: newValue,
  });
}

export function trackCompactViewToggled(isCompact: boolean): void {
  trackEvent("desktop_compact_view_toggled", {
    is_compact: isCompact,
  });
}

export function trackTransparentBackgroundToggled(isTransparent: boolean): void {
  trackEvent("desktop_transparent_background_toggled", {
    is_transparent: isTransparent,
  });
}

export function trackLogsSent(): void {
  trackEvent("desktop_logs_sent");
}

export function trackLogFileOpened(): void {
  trackEvent("desktop_log_file_opened");
}

export function trackDevToolsOpened(): void {
  trackEvent("desktop_devtools_opened");
}

// ========================================
// ONBOARDING EVENTS
// ========================================

export function trackOnboardingCompleted(): void {
  console.log("[Analytics] Onboarding completed event");
  trackEvent("desktop_onboarding_completed");
}

// ========================================
// TYPECHECK / CODE QUALITY EVENTS
// ========================================

export function trackTypecheckRun(
  workflowId: string,
  errorCount: number,
  warningCount: number,
  source: "manual" | "ai_tool" | "auto"
): void {
  trackEvent("desktop_typecheck_run", {
    workflow_id: workflowId,
    error_count: errorCount,
    warning_count: warningCount,
    source,
    has_errors: errorCount > 0,
  });
}

export function trackWorkflowCodeEdited(workflowId: string, fileName: string, editSource: "ai" | "user"): void {
  trackEvent("desktop_workflow_code_edited", {
    workflow_id: workflowId,
    file_name: fileName,
    edit_source: editSource,
  });
}

export function trackWorkflowExecutionAttempted(
  workflowId: string,
  workflowName: string,
  result: "success" | "error" | "timeout",
  errorMessage?: string,
  stepReached?: number,
  totalSteps?: number
): void {
  trackEvent("desktop_workflow_execution_attempted", {
    workflow_id: workflowId,
    workflow_name: workflowName,
    result,
    error_message: errorMessage,
    step_reached: stepReached,
    total_steps: totalSteps,
  });
}

// ========================================
// MCP CONNECTION EVENTS
// ========================================

export function trackMcpDisconnected(
  errorMessage: string,
  source: "polling" | "tool_execution" | "health_check"
): void {
  trackEvent("desktop_mcp_disconnected", {
    error_message: errorMessage,
    source,
  });
}

export function trackMcpReconnected(): void {
  trackEvent("desktop_mcp_reconnected");
}

export function trackMcpRestartInitiated(): void {
  trackEvent("desktop_mcp_restart_initiated");
}
