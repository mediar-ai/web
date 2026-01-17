import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
  isLoading?: boolean; // NEW: Track loading state during async operations
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  isLoading = false
}: ConfirmDialogProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    await onConfirm();
    // Don't close immediately - let parent handle closing after async operation
  };

  const handleCancel = () => {
    // Don't allow cancel while loading
    if (!isLoading) {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      handleCancel();
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 backdrop-blur-md border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-lg shadow-lg max-w-sm w-full mx-4 p-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 [.theme-classic_&]:border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-b [.theme-inverted_&]:border-white">
          <div className="flex items-center gap-3">
            {variant === 'destructive' && (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            )}
            <h2 className="text-lg font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">{title}</h2>
          </div>
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
        <div className="p-4">
          <p className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white text-sm leading-relaxed">
            {description}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 [.theme-classic_&]:border-t [.theme-classic_&]:border-black [.theme-inverted_&]:border-t [.theme-inverted_&]:border-white">
          <Button
            variant="secondary"
            onClick={handleCancel}
            disabled={isLoading}
            className="disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            className="disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-0.5 mr-2 h-4 w-4 inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {confirmText === 'Delete' ? 'Deleting...' : 'Loading...'}
              </>
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
