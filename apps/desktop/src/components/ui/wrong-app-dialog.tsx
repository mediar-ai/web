import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface WrongAppDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRestart: () => void;
  targetAppName: string;
  actualAppName: string;
}

export function WrongAppDialog({ isOpen, onClose, onRestart, targetAppName, actualAppName }: WrongAppDialogProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onRestart();
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
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Wrong Application</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-gray-600">
            You performed an action in <span className="font-semibold text-gray-900">{actualAppName}</span>, but you
            selected <span className="font-semibold text-gray-900">{targetAppName}</span> as your target application.
          </p>
          <p className="text-gray-500 text-sm mt-3">
            Would you like to restart recording and select a different target application?
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <Button variant="outline" onClick={onClose}>
            Cancel Recording
          </Button>
          <Button onClick={onRestart}>Restart Recording</Button>
        </div>
      </div>
    </div>
  );
}
