/**
 * useElicitationMemory Hook
 *
 * Provides memory functionality for remembering user choices.
 */

import { useCallback } from "react";
import { useElicitation } from "@/contexts/ElicitationContext";
import { ElicitationRequest, ElicitationMemoryEntry } from "@/lib/elicitation/types";
import { generateQuestionHash } from "@/lib/elicitation/infer-question-type";

interface UseElicitationMemoryResult {
  /** Check if we have a remembered answer for this request */
  hasRememberedAnswer: (request: ElicitationRequest) => boolean;
  /** Get the remembered answer for this request */
  getRememberedAnswer: (request: ElicitationRequest) => Record<string, unknown> | null;
  /** Remember an answer for future similar questions */
  rememberAnswer: (request: ElicitationRequest, answer: Record<string, unknown>, applyToSimilar?: boolean) => void;
  /** Forget a remembered answer */
  forgetAnswer: (request: ElicitationRequest) => void;
  /** Clear all remembered answers */
  clearAll: () => void;
}

export function useElicitationMemory(): UseElicitationMemoryResult {
  const { memory } = useElicitation();

  const hasRememberedAnswer = useCallback(
    (request: ElicitationRequest): boolean => {
      const hash = generateQuestionHash(request);
      const entry = memory.get(hash);
      return entry !== null && entry.applyToSimilar;
    },
    [memory]
  );

  const getRememberedAnswer = useCallback(
    (request: ElicitationRequest): Record<string, unknown> | null => {
      const hash = generateQuestionHash(request);
      const entry = memory.get(hash);
      if (entry && entry.applyToSimilar) {
        return entry.answer;
      }
      return null;
    },
    [memory]
  );

  const rememberAnswer = useCallback(
    (request: ElicitationRequest, answer: Record<string, unknown>, applyToSimilar = false): void => {
      const hash = generateQuestionHash(request);
      const entry: ElicitationMemoryEntry = {
        questionHash: hash,
        answer,
        timestamp: Date.now(),
        applyToSimilar,
      };
      memory.set(entry);
    },
    [memory]
  );

  const forgetAnswer = useCallback(
    (request: ElicitationRequest): void => {
      // We don't have a delete method, so we set with applyToSimilar: false
      const hash = generateQuestionHash(request);
      const existing = memory.get(hash);
      if (existing) {
        memory.set({
          ...existing,
          applyToSimilar: false,
        });
      }
    },
    [memory]
  );

  const clearAll = useCallback((): void => {
    memory.clear();
  }, [memory]);

  return {
    hasRememberedAnswer,
    getRememberedAnswer,
    rememberAnswer,
    forgetAnswer,
    clearAll,
  };
}
