import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RecordingMode = "continuous" | "step-by-step";

interface RecordingModeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: RecordingMode) => void;
}

export function RecordingModeDialog({ isOpen, onClose, onConfirm }: RecordingModeDialogProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [selectedMode, setSelectedMode] = useState<RecordingMode>("continuous");

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setSelectedMode("continuous");
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    console.log("[RecordingModeDialog] Selected mode:", selectedMode);
    onConfirm(selectedMode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Recording Mode</h2>
            <p className="text-sm text-gray-500 mt-1">Choose how to capture actions</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => setSelectedMode("continuous")}
              className={cn(
                "p-4 rounded-md border text-left transition-colors",
                selectedMode === "continuous" ? "border-black bg-gray-50" : "border-gray-200 hover:border-gray-300"
              )}
            >
              <div className="font-medium">Continuous</div>
              <div className="text-sm text-gray-500 mt-1">
                Captures everything automatically. Good for creating initial workflow drafts.
              </div>
            </button>
            <button
              onClick={() => setSelectedMode("step-by-step")}
              className={cn(
                "p-4 rounded-md border text-left transition-colors",
                selectedMode === "step-by-step" ? "border-black bg-gray-50" : "border-gray-200 hover:border-gray-300"
              )}
            >
              <div className="font-medium">Step-by-step</div>
              <div className="text-sm text-gray-500 mt-1">
                Select target app, review each action. Good for precise workflows.
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>{selectedMode === "continuous" ? "Start Recording" : "Next"}</Button>
        </div>
      </div>
    </div>
  );
}
