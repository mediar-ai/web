import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpotlightHint } from "@/components/onboarding";

interface NameInputDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void | Promise<void>;
  title: string;
  description: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  defaultValue?: string;
  isLoading?: boolean;
  showCreateHint?: boolean;
  tutorialAutoFillName?: string;
}

export function NameInputDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  placeholder = "Enter name...",
  confirmText = "Create",
  cancelText = "Cancel",
  defaultValue = "",
  isLoading = false,
  showCreateHint = false,
  tutorialAutoFillName,
}: NameInputDialogProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [inputValue, setInputValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setInputValue(defaultValue);
    } else {
      setIsVisible(false);
    }
  }, [isOpen, defaultValue]);

  // Auto-fill name for tutorial step 17
  useEffect(() => {
    if (isOpen && tutorialAutoFillName && !inputValue) {
      setInputValue(tutorialAutoFillName);
    }
  }, [isOpen, tutorialAutoFillName, inputValue]);

  const handleConfirm = async () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue) {
      return; // Don't allow empty names
    }
    await onConfirm(trimmedValue);
  };

  const handleCancel = () => {
    if (!isLoading) {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      handleCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputValue.trim() && !isLoading) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape" && !isLoading) {
      e.preventDefault();
      handleCancel();
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 backdrop-blur-md border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-lg shadow-lg max-w-md w-full mx-4 p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 [.theme-classic_&]:border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-b [.theme-inverted_&]:border-white">
          <h2 className="text-lg font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">{title}</h2>
          <button
            onClick={handleCancel}
            disabled={isLoading}
            className="p-1 [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10 rounded border border-transparent [.theme-classic_&]:hover:border-black [.theme-inverted_&]:hover:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Close"
          >
            <X className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <p className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white text-sm leading-relaxed">
            {description}
          </p>
          <Input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            autoFocus
            className="w-full [.theme-classic_&]:border-black [.theme-inverted_&]:border-white [.theme-classic_&]:text-black [.theme-inverted_&]:text-white"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 [.theme-classic_&]:border-t [.theme-classic_&]:border-black [.theme-inverted_&]:border-t [.theme-inverted_&]:border-white">
          <Button variant="secondary" onClick={handleCancel} disabled={isLoading}>
            {cancelText}
          </Button>
          <SpotlightHint show={showCreateHint} tooltip="Click to create your workflow" arrowPosition="top">
            <Button
              onClick={handleConfirm}
              disabled={isLoading || !inputValue.trim()}
              className="border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white"
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin -ml-0.5 mr-2 h-4 w-4 inline-block"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Creating...
                </>
              ) : (
                confirmText
              )}
            </Button>
          </SpotlightHint>
        </div>
      </div>
    </div>
  );
}
