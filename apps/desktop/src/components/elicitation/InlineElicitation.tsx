/**
 * InlineElicitation Component
 *
 * Renders elicitation form inline in chat instead of as a modal.
 * Supports enum choices (clickable buttons) and free-form text input.
 */

import React, { useCallback, useMemo, useState } from "react";
import { ElicitationRequest, ElicitationResponse } from "@/lib/elicitation/types";
import { schemaToFields, validateForm, analyzeSchema } from "@/lib/elicitation/schema-to-fields";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

interface InlineElicitationProps {
  request: ElicitationRequest;
  onRespond: (response: ElicitationResponse) => void;
  disabled?: boolean;
}

export function InlineElicitation({ request, onRespond, disabled }: InlineElicitationProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [textValue, setTextValue] = useState("");

  // Parse schema into fields
  const fields = useMemo(() => schemaToFields(request.requestedSchema), [request.requestedSchema]);

  // Analyze schema structure
  const schemaAnalysis = useMemo(() => analyzeSchema(request.requestedSchema), [request.requestedSchema]);

  // Find enum field if exists (for button rendering)
  const enumField = useMemo(() => {
    return fields.find(f => f.property.enum && f.property.enum.length > 0);
  }, [fields]);

  // Handle button click for enum choices
  const handleChoiceClick = useCallback(
    (choice: string) => {
      if (disabled || isSubmitting) return;
      setIsSubmitting(true);
      console.log("[InlineElicitation] User selected choice:", choice);
      onRespond({
        action: "accept",
        content: { [enumField?.key || "answer"]: choice },
      });
    },
    [disabled, isSubmitting, enumField, onRespond]
  );

  // Handle text submit
  const handleTextSubmit = useCallback(() => {
    if (disabled || isSubmitting || !textValue.trim()) return;
    setIsSubmitting(true);
    const key = fields[0]?.key || "answer";
    console.log("[InlineElicitation] User submitted text:", textValue);
    onRespond({
      action: "accept",
      content: { [key]: textValue.trim() },
    });
  }, [disabled, isSubmitting, textValue, fields, onRespond]);

  // Handle skip
  const handleSkip = useCallback(() => {
    if (disabled || isSubmitting) return;
    console.log("[InlineElicitation] User skipped");
    onRespond({ action: "decline" });
  }, [disabled, isSubmitting, onRespond]);

  // Handle key press for text input
  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleTextSubmit();
      }
    },
    [handleTextSubmit]
  );

  const isDisabled = disabled || isSubmitting;

  return (
    <div className="mt-3 p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800/50">
      {/* Question/Message */}
      <div className="mb-3">
        <MarkdownRenderer
          content={request.message}
          compact
          inheritColor
          className="text-neutral-700 dark:text-neutral-300 text-sm"
        />
      </div>

      {/* Enum choices as buttons */}
      {enumField && enumField.property.enum && (
        <div className="flex flex-wrap gap-2">
          {enumField.property.enum.map((choice, index) => {
            const displayName = enumField.property.enumNames?.[index] || choice;
            return (
              <button
                key={choice}
                onClick={() => handleChoiceClick(choice)}
                disabled={isDisabled}
                className={`
                  px-3 py-1.5 rounded-md text-sm font-medium
                  border border-neutral-300 dark:border-neutral-600
                  bg-white dark:bg-neutral-800
                  hover:bg-neutral-100 dark:hover:bg-neutral-700
                  hover:border-neutral-400 dark:hover:border-neutral-500
                  transition-colors duration-150
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${isSubmitting ? "cursor-wait" : ""}
                `}
              >
                {displayName}
              </button>
            );
          })}
          <button
            onClick={handleSkip}
            disabled={isDisabled}
            className="px-3 py-1.5 rounded-md text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
          >
            Skip
          </button>
        </div>
      )}

      {/* Free-form text input */}
      {!enumField && (
        <div className="flex gap-2">
          <input
            type="text"
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isDisabled}
            placeholder="Type your answer..."
            className={`
              flex-1 px-3 py-1.5 rounded-md text-sm
              border border-neutral-300 dark:border-neutral-600
              bg-white dark:bg-neutral-800
              text-neutral-900 dark:text-neutral-100
              placeholder:text-neutral-400 dark:placeholder:text-neutral-500
              focus:outline-none focus:ring-1 focus:ring-neutral-400
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          />
          <button
            onClick={handleTextSubmit}
            disabled={isDisabled || !textValue.trim()}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium
              bg-neutral-900 dark:bg-white
              text-white dark:text-neutral-900
              hover:bg-neutral-800 dark:hover:bg-neutral-100
              transition-colors duration-150
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            Submit
          </button>
          <button
            onClick={handleSkip}
            disabled={isDisabled}
            className="px-3 py-1.5 rounded-md text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
          >
            Skip
          </button>
        </div>
      )}

      {/* Submitting indicator */}
      {isSubmitting && <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Processing...</div>}
    </div>
  );
}
