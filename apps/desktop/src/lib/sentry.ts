import * as Sentry from "@sentry/react";

/**
 * NOTE: Sentry is automatically initialized by tauri-plugin-sentry!
 *
 * The Rust backend (lib.rs) initializes Sentry and the plugin automatically
 * injects @sentry/browser into the webview. This provides:
 * - Automatic error tracking across Rust and JavaScript
 * - Breadcrumbs from both frontend and backend
 * - Native crash reports
 * - Unified error context
 *
 * We keep @sentry/react only for the ErrorBoundary component and helper functions.
 * DO NOT call initSentry() - the plugin handles initialization automatically.
 */

// Helper function to capture custom errors
export function captureError(error: Error, context?: Record<string, any>) {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
    }
    Sentry.captureException(error);
  });
}

// Helper function to capture custom messages
export function captureMessage(message: string, level: Sentry.SeverityLevel = "info", context?: Record<string, any>) {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value);
      });
    }
    scope.setLevel(level);
    Sentry.captureMessage(message);
  });
}

// Helper function to add breadcrumbs
export function addBreadcrumb(message: string, category?: string, level: Sentry.SeverityLevel = "info") {
  Sentry.addBreadcrumb({
    message,
    category: category || "custom",
    level,
    timestamp: Date.now() / 1000,
  });
}

// Helper function to set user context
export function setUser(user: { id: string; email?: string; username?: string }) {
  Sentry.setUser(user);
}

// Export Sentry for direct usage when needed
export { Sentry };
