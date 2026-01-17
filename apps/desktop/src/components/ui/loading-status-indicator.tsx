import { useEffect, useState } from "react";

interface LoadingStatusIndicatorProps {
  loadingStatus: {
    phase: "connecting" | "waiting" | "streaming" | "processing_tools" | "rate_limited";
    detail: string;
    startTime: number;
  } | null;
}

export function LoadingStatusIndicator({ loadingStatus }: LoadingStatusIndicatorProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!loadingStatus?.startTime) {
      setElapsedMs(0);
      return;
    }

    // Update elapsed time every 100ms for smooth display
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - loadingStatus.startTime);
    }, 100);

    // Initial calculation
    setElapsedMs(Date.now() - loadingStatus.startTime);

    return () => clearInterval(interval);
  }, [loadingStatus?.startTime]);

  // Format elapsed time as seconds.milliseconds (e.g., "3.2s")
  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${seconds}.${tenths}s`;
  };

  const statusText = loadingStatus?.detail || "AI is thinking...";
  const elapsedText = formatElapsedTime(elapsedMs);

  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-2 text-black">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-xs text-black">{statusText}</span>
        <span className="text-xs text-gray-500 font-mono">{elapsedText}</span>
      </div>
    </div>
  );
}
