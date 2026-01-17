import { invoke } from "@tauri-apps/api/core";

// TypeScript types matching the Rust FocusState struct
export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusState {
  // Element identification
  element_id?: string;
  accessibility_id?: string;
  element_name?: string;
  element_role?: string;

  // Window context
  window_title: string;
  window_handle?: number;
  process_id?: number;
  application_name: string;

  // Element position and bounds
  element_bounds?: ElementBounds;
  window_bounds?: ElementBounds;

  // Additional context
  url?: string;
  timestamp: number;

  // Fallback restoration data
  element_text?: string;
  element_class?: string;
}

/**
 * Focus Management System for Workflow Execution
 *
 * This system helps maintain proper focus during workflow execution
 * by capturing and restoring focus states when switching between
 * Mediar window and target applications.
 */
export class FocusManager {
  private static instance: FocusManager;
  private capturedFocusState: FocusState | null = null;

  private constructor() { }

  public static getInstance(): FocusManager {
    if (!FocusManager.instance) {
      FocusManager.instance = new FocusManager();
    }
    return FocusManager.instance;
  }

  /**
   * Capture the current focus state before showing Mediar UI
   * This should be called before any Mediar UI interactions
   */
  async captureFocusState(): Promise<FocusState | null> {
    try {
      const captureStart = performance.now();
      const focusState = await invoke<FocusState>('capture_focus_state');
      console.log(`[PERF] invoke('capture_focus_state'): ${(performance.now() - captureStart).toFixed(1)}ms`);

      // 🚫 NEVER capture focus if it's currently on Mediar app
      if (FocusManager.isMediarFocusState(focusState)) {
        console.log('🚫 [FocusManager] Skipping focus capture - current focus is on Mediar app:', {
          application: focusState.application_name,
          window: focusState.window_title
        });
        // Don't update capturedFocusState if current focus is on Mediar
        return this.capturedFocusState; // Return existing state instead
      }

      this.capturedFocusState = focusState;
      // [FocusManager] Focus state captured
      return focusState;
    } catch (error) {
      // Check if the error is about Mediar focus (from Rust backend)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Cannot capture focus from Mediar application')) {
        console.log('🚫 [FocusManager] Backend prevented Mediar focus capture - using existing state');
        return this.capturedFocusState; // Return existing state
      }

      console.error('❌ [FocusManager] Failed to capture focus state:', error);
      return null;
    }
  }

  /**
   * Restore focus to the previously captured state
   * This should be called before executing workflow steps
   */
  async restoreFocusState(focusState?: FocusState): Promise<boolean> {
    const stateToRestore = focusState || this.capturedFocusState;

    if (!stateToRestore) {
      // No focus state to restore
      return false;
    }

    try {
      const restoreStart = performance.now();
      const success = await invoke<boolean>('restore_focus_state', { focusState: stateToRestore });
      console.log(`[PERF] invoke('restore_focus_state'): ${(performance.now() - restoreStart).toFixed(1)}ms`);

      return success;
    } catch (error) {
      console.error('❌ [FocusManager] Failed to restore focus state:', error);
      return false;
    }
  }

  /**
   * Get the currently cached focus state without capturing new one
   */
  async getCachedFocusState(): Promise<FocusState | null> {
    try {
      const cached = await invoke<FocusState | null>('get_cached_focus_state');
      return cached;
    } catch (error) {
      console.error('❌ [FocusManager] Failed to get cached focus state:', error);
      return null;
    }
  }

  /**
   * Clear the focus state cache
   */
  async clearFocusCache(): Promise<void> {
    try {
      await invoke('clear_focus_state_cache');
      this.capturedFocusState = null;

    } catch (error) {
      console.error('❌ [FocusManager] Failed to clear focus cache:', error);
    }
  }

  /**
   * Get the locally stored focus state (without calling Rust backend)
   */
  getStoredFocusState(): FocusState | null {
    return this.capturedFocusState;
  }

  /**
   * Prepare for workflow execution:
   * 1. Capture current focus if not already captured
   * 2. Restore to target application focus
   *
   * This is the main method to call before executing workflow steps
   */
  async prepareForWorkflowExecution(): Promise<boolean> {
    // [FocusManager] Preparing for workflow execution...');

    // If we don't have a captured state, capture current focus
    if (!this.capturedFocusState) {
      await this.captureFocusState();
    }

    // Restore focus to the target application
    if (this.capturedFocusState) {
      const restored = await this.restoreFocusState();
      if (restored) {
        // [FocusManager] Ready for workflow execution');
        return true;
      } else {
        console.warn('⚠️ [FocusManager] Focus restoration had issues, but continuing');
        return true; // Continue anyway, as partial restoration might be sufficient
      }
    }

    console.warn('⚠️ [FocusManager] No focus state available, continuing without restoration');
    return true;
  }

  /**
   * Helper method to determine if a focus state belongs to Mediar app
   * This can be used to filter out Mediar focus events
   */
  static isMediarFocusState(focusState: FocusState): boolean {
    const mediarIdentifiers = [
      'mediar',
      'Mediar',
      'MEDIAR',
      'tauri',
      'webview',
      'wry', // Tauri's webview engine
      'rust', // In case process shows as rust
      'mediar-app', // In case the exe name is shown
      'mediar.exe',
      'react'
    ];

    const appName = focusState.application_name.toLowerCase();
    const windowTitle = focusState.window_title.toLowerCase();

    // Check application name and window title
    const isMediarApp = mediarIdentifiers.some(identifier =>
      appName.includes(identifier.toLowerCase()) ||
      windowTitle.includes(identifier.toLowerCase())
    );

    // Additional check: if window title contains "Mediar Agent" or similar
    const isMediarWindow = windowTitle.includes('mediar agent') ||
      windowTitle.includes('ai agent') ||
      windowTitle.includes('workflow automation');

    const result = isMediarApp || isMediarWindow;

    if (result) {
      console.log('🔍 [FocusManager] Detected Mediar app focus:', {
        application: focusState.application_name,
        window: focusState.window_title,
        reason: isMediarApp ? 'app name match' : 'window title match'
      });
    }

    return result;
  }

  /**
   * Enhanced prepare method that ensures we don't restore focus to Mediar itself
   */
  async prepareForWorkflowExecutionSafe(): Promise<boolean> {
    const totalStart = performance.now();
    console.log('[PERF] prepareForWorkflowExecutionSafe: started');

    // Always check if we have a valid stored focus state first
    if (this.capturedFocusState && !FocusManager.isMediarFocusState(this.capturedFocusState)) {
      console.log('[PERF] prepareForWorkflowExecutionSafe: using stored state, calling restoreFocusState');
      const result = await this.restoreFocusState(this.capturedFocusState);
      console.log(`[PERF] prepareForWorkflowExecutionSafe: total (stored path): ${(performance.now() - totalStart).toFixed(1)}ms`);
      return result;
    }

    // If no valid stored state, try to capture current focus (but this will skip if it's Mediar)
    console.log('[PERF] prepareForWorkflowExecutionSafe: no stored state, calling captureFocusState');
    const currentFocus = await this.captureFocusState();

    if (currentFocus && !FocusManager.isMediarFocusState(currentFocus)) {
      console.log('[PERF] prepareForWorkflowExecutionSafe: captured valid state, calling restoreFocusState');
      const result = await this.restoreFocusState(currentFocus);
      console.log(`[PERF] prepareForWorkflowExecutionSafe: total (capture+restore path): ${(performance.now() - totalStart).toFixed(1)}ms`);
      return result;
    }

    // No valid focus state available - continuing without focus restoration
    console.log(`[PERF] prepareForWorkflowExecutionSafe: total (no-op path): ${(performance.now() - totalStart).toFixed(1)}ms`);
    return true; // Continue anyway - the workflow step might still work
  }
}

// Export singleton instance for easy access
export const focusManager = FocusManager.getInstance();

// Export individual functions for direct usage
export const captureFocusState = () => focusManager.captureFocusState();
export const restoreFocusState = (focusState?: FocusState) => focusManager.restoreFocusState(focusState);
export const prepareForWorkflowExecution = () => focusManager.prepareForWorkflowExecution();
export const prepareForWorkflowExecutionSafe = () => focusManager.prepareForWorkflowExecutionSafe();
export const clearFocusCache = () => focusManager.clearFocusCache();
