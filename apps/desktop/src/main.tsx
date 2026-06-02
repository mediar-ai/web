"use strict";

import * as Sentry from "@sentry/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { McpProvider } from "./contexts/McpContext";
import { AuthProvider } from "./hooks/useAuth";
import { ElicitationProvider } from "./contexts/ElicitationContext";
import { initializeAnalytics } from "./lib/analytics";
import { Logger } from "./lib/logging";

// Initialize Sentry for frontend console capture
// Note: tauri-plugin-sentry handles automatic initialization, but we enhance it
// with console integration to capture console.error/warn logs
if (import.meta.env.PROD) {
  // In production, enhance Sentry with console integration
  // The backend already initialized Sentry, we just add integrations
  Sentry.init({
    integrations: [
      Sentry.captureConsoleIntegration({
        levels: ["error", "warn"], // Capture console.error and console.warn (not log/info to avoid noise)
      }),
      Sentry.contextLinesIntegration(),
      Sentry.httpClientIntegration(),
    ],
    // Don't set DSN - it's already configured by tauri-plugin-sentry
    beforeSend(event) {
      // Filter out noisy errors if needed
      return event;
    },
  });
  console.log("✅ [Frontend] Sentry console integration enabled - console.error() and console.warn() will be captured");
}

// Initialize unified logging before app startup
console.log("🚀 [Frontend] Main.tsx is executing - about to initialize logger...");
Logger.init()
  .then(() => {
    // These console.log calls will now be captured to both browser console AND log files
    console.log("✅ [Frontend] Logging system initialized - console output now captured to files");
    console.log(`📁 [Frontend] Log location: ${import.meta.env.PROD ? "%LOCALAPPDATA%\\mediar\\logs" : "./logs"}`);
    console.log(`🔧 [Frontend] Build mode: ${import.meta.env.PROD ? "PRODUCTION" : "DEVELOPMENT"}`);
    Logger.info("App", "Mediar frontend starting up with unified logging enabled");

    // After a delay, check diagnostics to see if IPC calls are working
    setTimeout(() => {
      const diagnostics = Logger.getDiagnostics();
      console.log("📊 [Logger] Diagnostics after 2 seconds:", diagnostics);

      if (diagnostics.ipcErrorCount > 0) {
        console.error("❌ [Logger] IPC ERRORS DETECTED! Frontend logging is NOT working!");
        console.error("Last error:", diagnostics.lastIpcError);
      } else {
        console.log("✅ [Logger] IPC calls working - no errors detected");
      }

      // Expose diagnostics globally for debugging
      (window as any).__loggerDiagnostics = Logger.getDiagnostics;
    }, 2000);
  })
  .catch(err => {
    console.warn("Failed to initialize unified logging:", err);
  });

// Check which window this is FIRST (before initializing PostHog)
const urlParams = new URLSearchParams(window.location.search);
const windowType = urlParams.get("window");

// Overlay bar windows are transparent Tauri windows that only show a floating
// pill. Without this, the body's frosted backdrop paints a translucent
// rectangle across the whole window around the pill.
const OVERLAY_WINDOWS = ["recording-bar", "execution-bar", "ai-thinking-bar", "action-review"];
if (windowType && OVERLAY_WINDOWS.includes(windowType)) {
  document.documentElement.classList.add("overlay-window");
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (windowType === "recording-bar") {
  import("./recording-bar-component").then(({ RecordingBar }) => {
    root.render(<RecordingBar />);
  });
} else if (windowType === "execution-bar") {
  import("./execution-bar-component").then(({ ExecutionBar }) => {
    root.render(<ExecutionBar />);
  });
} else if (windowType === "ai-thinking-bar") {
  import("./ai-thinking-bar-component").then(({ AiThinkingBar }) => {
    root.render(<AiThinkingBar />);
  });
} else if (windowType === "action-review") {
  import("./action-review-component").then(({ ActionReview }) => {
    root.render(<ActionReview />);
  });
} else {
  // Initialize PostHog analytics ONLY for main window
  // Other windows (recording-bar, execution-bar, ai-thinking-bar) should NOT initialize PostHog
  // This prevents 4x redundant tracking and excessive $identify calls
  initializeAnalytics()
    .then(() => {
      console.log("✅ [Frontend] PostHog analytics initialized (main window only)");
    })
    .catch(err => {
      console.error("❌ [Frontend] Failed to initialize PostHog analytics:", err);
    });

  // Initialize the main application
  root.render(
    <React.StrictMode>
      <AuthProvider>
        <McpProvider>
          <ElicitationProvider>
            <App />
          </ElicitationProvider>
        </McpProvider>
      </AuthProvider>
    </React.StrictMode>
  );
}
