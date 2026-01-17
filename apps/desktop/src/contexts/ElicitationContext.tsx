/**
 * Elicitation Context
 *
 * Provides state management for the elicitation system.
 * Allows showing elicitation modals and collecting responses.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ElicitationContextValue,
  ElicitationMemoryEntry,
  ElicitationRenderMode,
  ElicitationRequest,
  ElicitationResponse,
  ElicitationState,
} from "@/lib/elicitation/types";
import { MEMORY_CONFIG, STORAGE_KEYS } from "@/lib/elicitation/constants";
import { registerElicitationHandler } from "@/lib/elicitation/mcp-integration";

// ============================================================================
// Context
// ============================================================================

const ElicitationContext = createContext<ElicitationContextValue | null>(null);

// ============================================================================
// Memory Helpers
// ============================================================================

function loadMemory(): Map<string, ElicitationMemoryEntry> {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.MEMORY);
    if (!stored) return new Map();

    const entries: ElicitationMemoryEntry[] = JSON.parse(stored);
    const now = Date.now();
    const expiryMs = MEMORY_CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    // Filter out expired entries
    const valid = entries.filter(e => now - e.timestamp < expiryMs);

    return new Map(valid.map(e => [e.questionHash, e]));
  } catch {
    return new Map();
  }
}

function saveMemory(memory: Map<string, ElicitationMemoryEntry>): void {
  try {
    const entries = Array.from(memory.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MEMORY_CONFIG.MAX_ENTRIES);

    localStorage.setItem(STORAGE_KEYS.MEMORY, JSON.stringify(entries));
  } catch {
    // Ignore storage errors
  }
}

// ============================================================================
// Provider
// ============================================================================

interface ElicitationProviderProps {
  children: React.ReactNode;
}

export function ElicitationProvider({ children }: ElicitationProviderProps) {
  // Render mode state (persisted separately so it survives elicitation cycles)
  const [renderMode, setRenderModeState] = useState<ElicitationRenderMode>("inline");

  // State
  const [state, setState] = useState<ElicitationState>({
    isOpen: false,
    request: null,
    renderMode: "inline",
  });

  // Memory for remembering choices
  const memoryRef = useRef(loadMemory());

  // Promise resolver for async response handling
  const resolverRef = useRef<((response: ElicitationResponse) => void) | null>(null);

  // Set render mode
  const setRenderMode = useCallback((mode: ElicitationRenderMode) => {
    setRenderModeState(mode);
    setState(prev => ({ ...prev, renderMode: mode }));
  }, []);

  // Show elicitation and wait for response
  const showElicitation = useCallback((request: ElicitationRequest): Promise<ElicitationResponse> => {
    return new Promise(resolve => {
      resolverRef.current = resolve;
      setState(prev => ({
        isOpen: true,
        request,
        renderMode: prev.renderMode,
      }));
    });
  }, []);

  // Register the handler with MCP integration when provider mounts
  useEffect(() => {
    const cleanup = registerElicitationHandler(showElicitation);
    return cleanup;
  }, [showElicitation]);

  // Respond to current elicitation
  const respond = useCallback((response: ElicitationResponse) => {
    if (resolverRef.current) {
      resolverRef.current(response);
      resolverRef.current = null;
    }
    setState(prev => ({
      isOpen: false,
      request: null,
      renderMode: prev.renderMode,
    }));
  }, []);

  // Close without responding (cancel)
  const close = useCallback(() => {
    respond({ action: "cancel" });
  }, [respond]);

  // Memory operations
  const memory = useMemo(
    () => ({
      get: (questionHash: string): ElicitationMemoryEntry | null => {
        return memoryRef.current.get(questionHash) ?? null;
      },
      set: (entry: ElicitationMemoryEntry): void => {
        memoryRef.current.set(entry.questionHash, entry);
        saveMemory(memoryRef.current);
      },
      clear: (): void => {
        memoryRef.current.clear();
        localStorage.removeItem(STORAGE_KEYS.MEMORY);
      },
    }),
    []
  );

  // Context value
  const value = useMemo<ElicitationContextValue>(
    () => ({
      state,
      showElicitation,
      respond,
      close,
      setRenderMode,
      memory,
    }),
    [state, showElicitation, respond, close, setRenderMode, memory]
  );

  return <ElicitationContext.Provider value={value}>{children}</ElicitationContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useElicitation(): ElicitationContextValue {
  const context = useContext(ElicitationContext);
  if (!context) {
    throw new Error("useElicitation must be used within ElicitationProvider");
  }
  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { ElicitationContext };
