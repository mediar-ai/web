/**
 * ElicitationHeader Component
 *
 * Context-aware header that changes based on question type.
 */

import React from "react";
import { AlertTriangle, HelpCircle, MessageCircle, X, Sparkles } from "lucide-react";
import { ElicitationRequest, QuestionType } from "@/lib/elicitation/types";
import { QUESTION_TYPE_CONFIGS, CONFIDENCE } from "@/lib/elicitation/constants";
import { inferQuestionType } from "@/lib/elicitation/infer-question-type";

interface ElicitationHeaderProps {
  request: ElicitationRequest;
  onClose: () => void;
}

const ICONS = {
  AlertTriangle,
  HelpCircle,
  MessageCircle,
};

export function ElicitationHeader({ request, onClose }: ElicitationHeaderProps) {
  const questionType = inferQuestionType(request);
  const config = QUESTION_TYPE_CONFIGS[questionType];
  const Icon = ICONS[config.icon as keyof typeof ICONS] || MessageCircle;

  const hasHighConfidence = request.suggestion && request.suggestion.confidence >= CONFIDENCE.MEDIUM;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`
            flex-shrink-0 w-10 h-10 rounded-full
            flex items-center justify-center
            ${config.bgColor}
          `}
        >
          <Icon className={`w-5 h-5 ${config.accentColor}`} />
        </div>

        {/* Title and context */}
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{config.title}</h2>

          {/* Context info */}
          {request.context?.toolName && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              While running:{" "}
              <code className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-xs font-mono">
                {request.context.toolName}
              </code>
            </p>
          )}

          {/* AI confidence indicator */}
          {hasHighConfidence && (
            <div className="flex items-center gap-1.5 text-sm">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-neutral-600 dark:text-neutral-400">
                AI is{" "}
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {Math.round(request.suggestion!.confidence * 100)}% confident
                </span>
                {request.suggestion!.reasoning && <span> — {request.suggestion!.reasoning}</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="
          flex-shrink-0 p-2 -m-2 rounded-lg
          text-neutral-400 hover:text-neutral-600
          dark:text-neutral-500 dark:hover:text-neutral-300
          hover:bg-neutral-100 dark:hover:bg-neutral-800
          transition-colors duration-150
        "
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
