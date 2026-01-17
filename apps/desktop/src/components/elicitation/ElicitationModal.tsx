/**
 * ElicitationModal Component
 *
 * Main modal for AI elicitation requests with animations.
 */

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useElicitation } from "@/contexts/ElicitationContext";
import { ElicitationHeader } from "./ElicitationHeader";
import { ElicitationForm } from "./ElicitationForm";
import { inferQuestionType } from "@/lib/elicitation/infer-question-type";
import { QUESTION_TYPE_CONFIGS, TIMING, Z_INDEX, A11Y } from "@/lib/elicitation/constants";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

export function ElicitationModal() {
  const { state, respond, close } = useElicitation();
  const { isOpen, request } = state;

  // Track if we're submitting (for loading state)
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset submitting state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Handle submit
  const handleSubmit = useCallback(
    (values: Record<string, unknown>) => {
      setIsSubmitting(true);
      // Brief delay for visual feedback
      setTimeout(() => {
        respond({ action: "accept", content: values });
      }, TIMING.SUCCESS_DELAY);
    },
    [respond]
  );

  // Handle skip (decline)
  const handleSkip = useCallback(() => {
    respond({ action: "decline" });
  }, [respond]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    close();
  }, [close]);

  // Get question type config for styling
  const questionType = request ? inferQuestionType(request) : "question";
  const config = QUESTION_TYPE_CONFIGS[questionType];

  // Only render modal when in modal mode
  const renderMode = state.renderMode;

  return (
    <AnimatePresence>
      {isOpen && request && renderMode === "modal" && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: TIMING.BACKDROP_FADE / 1000 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            style={{ zIndex: Z_INDEX.BACKDROP }}
            onClick={handleCancel}
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{
              duration: TIMING.MODAL_ENTER / 1000,
              ease: [0.4, 0, 0.2, 1],
            }}
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: Z_INDEX.MODAL }}
            role={A11Y.MODAL_ROLE}
            aria-label={A11Y.MODAL_LABEL}
            aria-modal="true"
          >
            <div
              className={`
                w-full max-w-lg
                bg-white dark:bg-neutral-900
                rounded-2xl shadow-2xl
                border-2 ${config.borderColor}
                overflow-hidden
              `}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 pt-6 pb-4">
                <ElicitationHeader request={request} onClose={handleCancel} />
              </div>

              {/* Message */}
              <div className="px-6 pb-4">
                <MarkdownRenderer
                  content={request.message}
                  compact
                  inheritColor
                  className="text-neutral-700 dark:text-neutral-300"
                />
              </div>

              {/* Form */}
              <div className="px-6 pb-6">
                <ElicitationForm
                  request={request}
                  onSubmit={handleSubmit}
                  onSkip={handleSkip}
                  onCancel={handleCancel}
                  disabled={isSubmitting}
                />
              </div>

              {/* Submitting overlay */}
              <AnimatePresence>
                {isSubmitting && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-white/80 dark:bg-neutral-900/80 flex items-center justify-center"
                  >
                    <div className="flex items-center gap-3 text-neutral-600 dark:text-neutral-400">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                          repeat: Infinity,
                          duration: 1,
                          ease: "linear",
                        }}
                        className="w-5 h-5 border-2 border-current border-t-transparent rounded-full"
                      />
                      <span>Got it!</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
