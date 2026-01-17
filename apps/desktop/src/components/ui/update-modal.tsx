import { Download, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  updateInfo: UpdateInfo | null;
  onDownload: () => void;
  onRemindLater: () => void;
  onSkipVersion: () => void;
  isDownloading?: boolean;
  downloadProgress?: number;
  isReadyToInstall?: boolean;
  onInstallAndRestart?: () => void;
}

export function UpdateModal({
  isOpen,
  updateInfo,
  onDownload,
  onRemindLater,
  onSkipVersion,
  isDownloading = false,
  downloadProgress = 0,
  isReadyToInstall = false,
  onInstallAndRestart,
}: UpdateModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Don't allow closing during download
    if (e.target === e.currentTarget && !isDownloading) {
      onRemindLater();
    }
  };

  if (!isVisible || !updateInfo) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50" onClick={handleBackdropClick}>
      {/* Draggable title bar area at top */}
      <div
        className="h-8 flex-shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={async e => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          e.stopPropagation();
          try {
            const appWindow = getCurrentWindow();
            await appWindow.startDragging();
          } catch (error) {
            console.error("Drag failed:", error);
          }
        }}
        onClick={e => e.stopPropagation()}
      />
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-white backdrop-blur-md border-2 border-black rounded-lg shadow-lg max-w-md w-full mx-4 p-0">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black">
            <div className="flex items-center gap-3">
              {isReadyToInstall ? (
                <RefreshCw className="w-5 h-5 text-black" />
              ) : (
                <Download className="w-5 h-5 text-black" />
              )}
              <h2 className="text-lg font-medium text-black">
                {isReadyToInstall ? "Update Ready" : "Update Available"}
              </h2>
            </div>
            <button
              onClick={onRemindLater}
              disabled={isDownloading}
              className="p-1 hover:bg-black/5 rounded border border-transparent hover:border-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Close"
            >
              <X className="w-4 h-4 text-black" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3">
            {isReadyToInstall ? (
              <>
                <p className="text-black text-sm leading-relaxed">
                  Version <span className="font-mono font-semibold">{updateInfo.version}</span> has been downloaded and
                  is ready to install.
                </p>
                <p className="text-black text-sm leading-relaxed">
                  The application will restart to complete the installation.
                </p>
              </>
            ) : (
              <>
                <p className="text-black text-sm leading-relaxed">
                  A new version is available: <span className="font-mono font-semibold">{updateInfo.version}</span>
                </p>
                <p className="text-xs text-gray-600">
                  Current version: <span className="font-mono">{updateInfo.currentVersion}</span>
                </p>

                {updateInfo.body && (
                  <div className="mt-3 p-3 bg-gray-50 border border-black rounded text-xs">
                    <p className="font-medium text-black mb-1">What&apos;s new:</p>
                    <p className="text-gray-700 whitespace-pre-wrap">{updateInfo.body}</p>
                  </div>
                )}

                {isDownloading && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-black">Downloading update...</span>
                      <span className="text-xs font-mono text-black">{Math.round(downloadProgress)}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 border border-black rounded overflow-hidden">
                      <div
                        className="h-full bg-black transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 p-4 border-t border-black">
            {isReadyToInstall ? (
              <>
                <Button variant="secondary" onClick={onRemindLater}>
                  Restart Later
                </Button>
                <Button onClick={onInstallAndRestart}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Restart Now
                </Button>
              </>
            ) : isDownloading ? (
              <Button variant="outline" disabled>
                Downloading...
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onSkipVersion} disabled={isDownloading}>
                  Skip Version
                </Button>
                <Button variant="secondary" onClick={onRemindLater} disabled={isDownloading}>
                  Remind Later
                </Button>
                <Button onClick={onDownload} disabled={isDownloading}>
                  <Download className="w-4 h-4 mr-2" />
                  Download Update
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
