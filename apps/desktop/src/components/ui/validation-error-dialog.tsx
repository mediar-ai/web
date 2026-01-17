import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export interface ValidationErrorDetails {
  stepIndex: number;
  stepId: string | null;
  isInExecutionRange: boolean;
  executionRange: { start: number; end: number };
  message: string;
  workflowName?: string;
  workflowId?: number;
}

interface ValidationErrorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  error: ValidationErrorDetails | null;
}

export function ValidationErrorDialog({ isOpen, onClose, error }: ValidationErrorDialogProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isVisible || !error) return null;

  const rangeText = error.executionRange
    ? `Steps ${error.executionRange.start} to ${error.executionRange.end}`
    : "Unknown range";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 backdrop-blur-md border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-lg shadow-lg max-w-md w-full mx-4 p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 [.theme-classic_&]:border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-b [.theme-inverted_&]:border-white">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
              Workflow Validation Error
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10 rounded border border-transparent [.theme-classic_&]:hover:border-black [.theme-inverted_&]:hover:border-white transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <p className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white text-sm font-medium">
              Step {error.stepIndex} is invalid
              {error.stepId && <span className="text-gray-500"> (ID: {error.stepId})</span>}
            </p>

            <p className="text-sm text-gray-600 [.theme-inverted_&]:text-gray-400">
              This step is missing required fields (tool_name or group_name).
            </p>

            {!error.isInExecutionRange && (
              <div className="mt-3 p-3 [.theme-classic_&]:bg-black/5 [.theme-inverted_&]:bg-white/5 border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-md">
                <p className="text-sm [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
                  <strong>Note:</strong> This step is outside your execution range ({rangeText}), but it still blocks
                  execution. Consider fixing or removing this step.
                </p>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500 [.theme-inverted_&]:text-gray-400 bg-gray-100 [.theme-inverted_&]:bg-gray-800 p-2 rounded font-mono overflow-x-auto">
            {error.message}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 [.theme-classic_&]:border-t [.theme-classic_&]:border-black [.theme-inverted_&]:border-t [.theme-inverted_&]:border-white">
          <Button onClick={onClose}>OK</Button>
        </div>
      </div>
    </div>
  );
}
