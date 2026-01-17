import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { identifyUser, trackLoginInitiated, trackLoginSuccess, trackLogout } from "../lib/analytics";

/**
 * Pre-warm Claude Code ACP connection after login for fast session creation
 * This spawns the process in background so first session starts in ~5s instead of ~20s
 */
async function warmUpClaudeCode(): Promise<void> {
  try {
    const cwd = await invoke<string>("get_home_dir").catch(() => "C:\\Users\\matt");
    console.log("[AUTH] Pre-warming Claude Code with cwd:", cwd);
    await invoke("warm_up_claude_code", { cwd });
    console.log("[AUTH] Claude Code pre-warming initiated");
  } catch (err) {
    // Non-critical - just log warning and continue
    console.warn("[AUTH] Claude Code pre-warming failed:", err);
  }
}

export interface UserInfo {
  userId: string; // Backend sends camelCase
  user_id?: string; // Keep for backward compatibility
  email: string;
  orgId?: string; // Backend sends camelCase
  org_id?: string; // Keep for backward compatibility
  orgRole?: string; // Backend sends camelCase
  org_role?: string; // Keep for backward compatibility
  orgName?: string; // Backend sends camelCase
  org_name?: string; // Keep for backward compatibility
}

export interface AuthStatus {
  is_authenticated: boolean;
  user: UserInfo | null;
}

export interface AuthState {
  authStatus: AuthStatus;
  isLoading: boolean;
  isPolling: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  validateSession: () => Promise<void>;
}

// Create context with undefined default - will be provided by AuthProvider
const AuthContext = createContext<AuthState | undefined>(undefined);

// AuthProvider component - wraps the app and provides auth state to all consumers
export function AuthProvider({ children }: { children: ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    is_authenticated: false,
    user: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const revalidationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-validate session on mount
  useEffect(() => {
    validateSession();
  }, []);

  // Periodic background revalidation - checks if user is still allowed access
  // Runs silently without affecting UI, only acts on blocked errors
  useEffect(() => {
    // Only start periodic checks when authenticated
    if (!authStatus.is_authenticated) {
      if (revalidationIntervalRef.current) {
        clearInterval(revalidationIntervalRef.current);
        revalidationIntervalRef.current = null;
      }
      return;
    }

    const REVALIDATION_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    const backgroundRevalidate = async () => {
      try {
        console.log("[AUTH] Background revalidation check...");
        const userInfo = await invoke<UserInfo | null>("validate_session");

        if (userInfo) {
          console.log("[AUTH] Background revalidation: session still valid");
          // Session still valid, no action needed
        } else {
          // Session no longer valid (token expired or revoked)
          console.log("[AUTH] Background revalidation: session invalid, logging out");
          setAuthStatus({ is_authenticated: false, user: null });
          setError("Your session has expired. Please sign in again.");
        }
      } catch (err) {
        // Check if this is a blocked error (trial expired, suspended)
        const errorMessage = typeof err === "string" ? err : err instanceof Error ? err.message : "";
        const isBlockedError =
          errorMessage.toLowerCase().includes("trial") ||
          errorMessage.toLowerCase().includes("expired") ||
          errorMessage.toLowerCase().includes("suspended") ||
          errorMessage.toLowerCase().includes("blocked");

        if (isBlockedError) {
          console.log("[AUTH] Background revalidation: user blocked -", errorMessage);
          setAuthStatus({ is_authenticated: false, user: null });
          setError(errorMessage);
        } else {
          // Network error or transient failure - silently ignore
          console.warn("[AUTH] Background revalidation failed (will retry):", err);
        }
      }
    };

    // Start periodic revalidation
    console.log("[AUTH] Starting periodic revalidation (every 30 min)");
    revalidationIntervalRef.current = setInterval(backgroundRevalidate, REVALIDATION_INTERVAL_MS);

    return () => {
      if (revalidationIntervalRef.current) {
        clearInterval(revalidationIntervalRef.current);
        revalidationIntervalRef.current = null;
      }
    };
  }, [authStatus.is_authenticated]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  // Listen for deep-link auth callback events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<{ token: string; userId: string; email: string }>("auth-callback", async event => {
          console.log("[AUTH] Deep-link auth callback received:", event.payload);

          try {
            // Call handle_auth_callback to validate and store the token
            const userInfo = await invoke<UserInfo>("handle_auth_callback", {
              token: event.payload.token,
              userId: event.payload.userId,
              email: event.payload.email,
            });

            console.log("[AUTH] Deep-link authentication successful:", userInfo);
            setAuthStatus({
              is_authenticated: true,
              user: userInfo,
            });
            setIsPolling(false);
            setError(null);

            // Track authentication success and identify user in PostHog
            identifyUser(userInfo.userId, userInfo.email);
            trackLoginSuccess(userInfo.user_id, userInfo.email);

            // Pre-warm Claude Code for fast session creation
            warmUpClaudeCode();

            // Clear any polling interval if it's running
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          } catch (err) {
            console.error("[AUTH] Deep-link auth callback failed:", err);
            setError(err instanceof Error ? err.message : "Deep-link authentication failed");
            setIsPolling(false);
          }
        });
      } catch (err) {
        console.error("[AUTH] Failed to setup deep-link listener:", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const startPolling = async (sessionId: string) => {
    setIsPolling(true);
    setError(null);
    console.log("[AUTH] Starting polling for session:", sessionId);

    const maxAttempts = 150; // 5 minutes at 2-second intervals
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        console.log("[AUTH] Polling timeout reached");
        setIsPolling(false);
        setError("Authentication timeout - please try again");
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        return;
      }

      attempts++;

      try {
        console.log(`[AUTH] Polling attempt ${attempts}/${maxAttempts}...`);
        const userInfo = await invoke<UserInfo | null>("poll_auth_session", {
          sessionId,
        });

        if (userInfo) {
          console.log("[AUTH] Authentication successful:", userInfo);
          setAuthStatus({
            is_authenticated: true,
            user: userInfo,
          });
          setIsPolling(false);
          setError(null);

          // Track authentication success and identify user in PostHog
          identifyUser(userInfo.userId, userInfo.email);
          trackLoginSuccess(userInfo.user_id, userInfo.email);

          // Pre-warm Claude Code for fast session creation
          warmUpClaudeCode();

          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      } catch (err) {
        console.error("[AUTH] Polling error:", err);
        setIsPolling(false);
        // Tauri errors come as strings, not Error objects
        const errorMessage =
          typeof err === "string" ? err : err instanceof Error ? err.message : "Authentication failed";
        setError(errorMessage);

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    };

    // Start polling immediately
    await poll();

    // Then poll every 2 seconds
    pollingIntervalRef.current = setInterval(poll, 2000);
  };

  const login = async () => {
    try {
      setError(null);
      console.log("[AUTH] Initiating login...");

      // Track login initiated event
      trackLoginInitiated();

      // Get session ID from backend
      const sessionId = await invoke<string>("login_command");
      console.log("[AUTH] Session ID received:", sessionId);

      // Start polling for authentication
      await startPolling(sessionId);
    } catch (err) {
      console.error("[AUTH] Failed to initiate login:", err);
      setError(err instanceof Error ? err.message : "Failed to open browser");
      throw err;
    }
  };

  const logout = async () => {
    try {
      setError(null);
      console.log("[AUTH] Logging out...");

      // Track logout event before clearing user
      trackLogout();

      await invoke("logout_command");
      setAuthStatus({
        is_authenticated: false,
        user: null,
      });
      console.log("[AUTH] Logged out successfully");
    } catch (err) {
      console.error("[AUTH] Failed to logout:", err);
      setError(err instanceof Error ? err.message : "Failed to logout");
      throw err;
    }
  };

  const validateSession = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const userInfo = await invoke<UserInfo | null>("validate_session");

      if (userInfo) {
        console.log("[AUTH] Session valid:", userInfo);
        setAuthStatus({
          is_authenticated: true,
          user: userInfo,
        });

        // Identify user in PostHog on session validation
        identifyUser(userInfo.userId, userInfo.email);

        // Pre-warm Claude Code for fast session creation (user already logged in)
        warmUpClaudeCode();
      } else {
        console.log("[AUTH] No valid session found");
        setAuthStatus({
          is_authenticated: false,
          user: null,
        });
      }
    } catch (err) {
      console.error("[AUTH] Session validation failed:", err);
      // Tauri errors come as strings, not Error objects
      const errorMessage =
        typeof err === "string" ? err : err instanceof Error ? err.message : "Session validation failed";
      setError(errorMessage);
      setAuthStatus({
        is_authenticated: false,
        user: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const value: AuthState = {
    authStatus,
    isLoading,
    isPolling,
    error,
    login,
    logout,
    validateSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// useAuth hook - consumes AuthContext, ensures it is used within AuthProvider
export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
