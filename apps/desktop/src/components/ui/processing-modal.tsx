import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

interface LocalProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  stageIndex: number;
  totalStages: number;
  stageTotals: number[];
}

interface CloudProgress {
  processedCount: number;
  pendingCount: number;
  progressPercent: number;
}

interface SynthesisProgress {
  progress?: number;
}

interface ProcessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  localProgress: LocalProgress | null;
  isLocalProcessing: boolean;
  cloudProgress: CloudProgress | null;
  isCloudProcessing: boolean;
  isSynthesizing: boolean;
  synthesisProgress: SynthesisProgress | null;
  error: string | null;
}

export function ProcessingModal({
  isOpen,
  onClose,
  localProgress,
  isLocalProcessing,
  cloudProgress,
  isCloudProcessing,
  isSynthesizing,
  synthesisProgress,
  error,
}: ProcessingModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  if (!isVisible) return null;

  const getLocalStageLabel = (stage: string) => {
    switch (stage) {
      case "step_analysis":
        return "Analyzing steps";
      case "labeling":
        return "Labeling";
      case "synthesis":
        return "Synthesizing";
      case "generation":
        return "Generating files";
      default:
        return stage;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 backdrop-blur-md border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-lg shadow-lg max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 [.theme-classic_&]:border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-b [.theme-inverted_&]:border-white">
          <h2 className="text-lg font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
            Processing Recording
          </h2>
          <button
            onClick={onClose}
            className="p-1 [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10 rounded border border-transparent [.theme-classic_&]:hover:border-black [.theme-inverted_&]:hover:border-white transition-colors"
            title="Minimize to bar"
          >
            <X className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Local Processing - show "starting" when no progress yet */}
          {isLocalProcessing && !localProgress && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                <span className="font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
                  Starting Local Processing...
                </span>
              </div>
              <p className="pl-6 text-sm [.theme-classic_&]:text-gray-600 [.theme-inverted_&]:text-gray-400">
                Preparing to analyze your recording with Gemini
              </p>
            </div>
          )}

          {/* Local Processing - show all stages upfront */}
          {isLocalProcessing && localProgress && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                <span className="font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
                  Local Processing
                </span>
              </div>
              {/* All 4 stages */}
              <div className="pl-6 space-y-2">
                {["step_analysis", "labeling", "synthesis", "generation"].map((stage, idx) => {
                  const isCurrentStage = localProgress.stageIndex === idx;
                  const isCompleted = localProgress.stageIndex > idx;
                  const stageTotal = localProgress.stageTotals?.[idx] ?? 0;
                  const stageCurrent = isCurrentStage ? localProgress.current : isCompleted ? stageTotal : 0;
                  const progress = stageTotal > 0 ? (stageCurrent / stageTotal) * 100 : 0;

                  return (
                    <div key={stage} className="space-y-0.5">
                      <div className="flex items-center justify-between text-sm">
                        <span
                          className={`${isCurrentStage ? "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white font-medium" : isCompleted ? "[.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400" : "[.theme-classic_&]:text-gray-400 [.theme-inverted_&]:text-gray-500"}`}
                        >
                          {getLocalStageLabel(stage)}
                        </span>
                        <span className="[.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400 text-xs">
                          {stageCurrent}/{stageTotal}
                        </span>
                      </div>
                      <div className="h-1 bg-gray-200 [.theme-inverted_&]:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${isCompleted ? "bg-gray-400 [.theme-inverted_&]:bg-gray-500" : "bg-black [.theme-inverted_&]:bg-white"}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CLOUD PROCESSING DISABLED - local processing only */}
          {/* {isCloudProcessing && cloudProgress && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                <span className="font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
                  Cloud Processing
                </span>
              </div>
              <div className="pl-6 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="[.theme-classic_&]:text-gray-700 [.theme-inverted_&]:text-gray-300">
                    Processing events
                  </span>
                  <span className="[.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400">
                    {cloudProgress.processedCount}/{cloudProgress.processedCount + cloudProgress.pendingCount} (
                    {cloudProgress.progressPercent}%)
                  </span>
                </div>
                <div className="h-1.5 bg-gray-200 [.theme-inverted_&]:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black [.theme-inverted_&]:bg-white transition-all duration-300"
                    style={{ width: `${cloudProgress.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          )} */}

          {/* CLOUD PROCESSING DISABLED - synthesis is cloud-based */}
          {/* {isSynthesizing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                <span className="font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
                  Generating Workflow
                </span>
              </div>
              {synthesisProgress?.progress !== undefined && (
                <div className="pl-6 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="[.theme-classic_&]:text-gray-700 [.theme-inverted_&]:text-gray-300">
                      Synthesizing
                    </span>
                    <span className="[.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400">
                      {synthesisProgress.progress}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-200 [.theme-inverted_&]:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-black [.theme-inverted_&]:bg-white transition-all duration-300"
                      style={{ width: `${synthesisProgress.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )} */}

          {/* Error */}
          {error && (
            <div className="text-sm text-red-600 [.theme-inverted_&]:text-red-400 bg-red-50 [.theme-inverted_&]:bg-red-900/20 p-2 rounded">
              {error}
            </div>
          )}

          {/* No active processing message - only check local processing (cloud disabled) */}
          {!isLocalProcessing && !error && (
            <div className="text-sm [.theme-classic_&]:text-gray-500 [.theme-inverted_&]:text-gray-400 text-center py-2">
              Processing complete
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
