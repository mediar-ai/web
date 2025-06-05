import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAutoDetectionProps {
  stream: MediaStream | null;
  streamRef: React.RefObject<MediaStream | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  monitoringCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  logToUI: (...args: unknown[]) => void;
  captureFrameToBuffer: (changePercent: number) => Promise<void>;
  initialAutoDetectionEnabled?: boolean;
  initialMonitoringFrequency?: number;
  initialChangeThreshold?: number;
  initialStabilityDelay?: number;
  initialPixelDifferenceThreshold?: number;
}

interface UseAutoDetectionReturn {
  autoDetectionEnabled: boolean;
  setAutoDetectionEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  monitoringFrequency: number;
  setMonitoringFrequency: React.Dispatch<React.SetStateAction<number>>;
  changeThreshold: number;
  setChangeThreshold: React.Dispatch<React.SetStateAction<number>>;
  stabilityDelay: number;
  setStabilityDelay: React.Dispatch<React.SetStateAction<number>>;
  pixelDifferenceThreshold: number;
  setPixelDifferenceThreshold: React.Dispatch<React.SetStateAction<number>>;
  isMonitoring: boolean;
  displayChangePercent: number;
}

export function useAutoDetection({
  stream,
  streamRef,
  videoRef,
  monitoringCanvasRef,
  logToUI,
  captureFrameToBuffer,
  initialAutoDetectionEnabled = true,
  initialMonitoringFrequency = 200,
  initialChangeThreshold = 1.0,
  initialStabilityDelay = 500,
  initialPixelDifferenceThreshold = 20,
}: UseAutoDetectionProps): UseAutoDetectionReturn {
  const [autoDetectionEnabled, setAutoDetectionEnabled] = useState<boolean>(initialAutoDetectionEnabled);
  const [monitoringFrequency, setMonitoringFrequency] = useState<number>(initialMonitoringFrequency);
  const [changeThreshold, setChangeThreshold] = useState<number>(initialChangeThreshold);
  const [stabilityDelay, setStabilityDelay] = useState<number>(initialStabilityDelay);
  const [pixelDifferenceThreshold, setPixelDifferenceThreshold] = useState<number>(initialPixelDifferenceThreshold);

  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [lastFrameData, setLastFrameData] = useState<Uint8ClampedArray | null>(null);
  const [activityDetected, setActivityDetected] = useState<boolean>(false);
  const [lastActivityTime, setLastActivityTime] = useState<number>(0);
  const monitoringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentChangePercentRef = useRef<number>(0);
  const [displayChangePercent, setDisplayChangePercent] = useState<number>(0);
  const lastDisplayChangeRef = useRef<number>(0);

  // Refs to hold current values for stable callbacks
  const activityDetectedRef = useRef(activityDetected);
  useEffect(() => { activityDetectedRef.current = activityDetected; }, [activityDetected]);
  
  const lastActivityTimeRef = useRef(lastActivityTime);
  useEffect(() => { lastActivityTimeRef.current = lastActivityTime; }, [lastActivityTime]);
  
  const stabilityDelayRef = useRef(stabilityDelay);
  useEffect(() => { stabilityDelayRef.current = stabilityDelay; }, [stabilityDelay]);
  
  const autoDetectionEnabledRef = useRef(autoDetectionEnabled);
  useEffect(() => { autoDetectionEnabledRef.current = autoDetectionEnabled; }, [autoDetectionEnabled]);
  
  const changeThresholdRef = useRef(changeThreshold);
  useEffect(() => { changeThresholdRef.current = changeThreshold; }, [changeThreshold]);
  
  const monitoringFrequencyRef = useRef(monitoringFrequency);
  useEffect(() => { monitoringFrequencyRef.current = monitoringFrequency; }, [monitoringFrequency]);

  const isMonitoringRef = useRef(isMonitoring);
  useEffect(() => { isMonitoringRef.current = isMonitoring; }, [isMonitoring]);

  const lastFrameDataRef = useRef(lastFrameData);
  useEffect(() => { lastFrameDataRef.current = lastFrameData; }, [lastFrameData]);

  const getFrameDataForComparison = useCallback(
    (video: HTMLVideoElement): Uint8ClampedArray | null => {
      if (!monitoringCanvasRef.current) return null;
      const canvas = monitoringCanvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      const smallWidth = 160;
      const smallHeight = 120;
      canvas.width = smallWidth;
      canvas.height = smallHeight;
      context.drawImage(video, 0, 0, smallWidth, smallHeight);
      return context.getImageData(0, 0, smallWidth, smallHeight).data;
    },
    [monitoringCanvasRef],
  );

  const calculateChangePercentage = useCallback(
    (
      current: Uint8ClampedArray | null,
      previous: Uint8ClampedArray | null,
      threshold: number,
    ): number => {
      if (!current || !previous) return 0;
      if (current === previous) return 0;
      if (current.length !== previous.length) {
        console.warn('[calculateChangePercentage] Frame lengths differ, returning 100% change.');
        return 100;
      }

      let changedPixels = 0;
      const pixelCount = current.length / 4;

      for (let i = 0; i < current.length; i += 4) {
        const diffR = Math.abs(current[i] - previous[i]);
        const diffG = Math.abs(current[i + 1] - previous[i + 1]);
        const diffB = Math.abs(current[i + 2] - previous[i + 2]);
        const avgDifference = (diffR + diffG + diffB) / 3;

        if (avgDifference > threshold) {
          changedPixels++;
        }
      }
      return (changedPixels / pixelCount) * 100;
    },
    [],
  );

  const handleActivityDetection = useCallback(() => {
    const now = Date.now();
    setLastActivityTime(now);
    if (!activityDetectedRef.current) {
      setActivityDetected(true);
      logToUI(
        '[Auto-Detection] 🟡 Activity period started - Current Change:',
        currentChangePercentRef.current.toFixed(2) + '%',
      );
    }
  }, [logToUI, setLastActivityTime, setActivityDetected]);

  const checkForStability = useCallback(() => {
    const now = Date.now();
    if (
      activityDetectedRef.current &&
      (now - lastActivityTimeRef.current > stabilityDelayRef.current)
    ) {
      setActivityDetected(false);
      logToUI(
        '[Auto-Detection] 🟢 Screen relatively stable after activity burst. Last change:',
        currentChangePercentRef.current.toFixed(2) + '%',
      );
    }
  }, [logToUI, setActivityDetected]); // stabilityDelayRef, activityDetectedRef, lastActivityTimeRef, currentChangePercentRef are read from refs

  const monitoringLoop = useCallback(() => {
    if (
      !streamRef.current || // Use streamRef from props
      !videoRef.current ||
      !autoDetectionEnabledRef.current // Use the ref for autoDetectionEnabled
    ) return;
    
    const video = videoRef.current;
    if (video.readyState < video.HAVE_METADATA) return;

    const currentFrameData = getFrameDataForComparison(video);

    if (lastFrameDataRef.current && currentFrameData) {
      const changePercent = calculateChangePercentage(
        currentFrameData,
        lastFrameDataRef.current,
        pixelDifferenceThreshold, // Direct state access, or use a ref if stability is critical for monitoringLoop
      );
      currentChangePercentRef.current = changePercent;

      if (Math.abs(changePercent - lastDisplayChangeRef.current) > 0.1) {
        lastDisplayChangeRef.current = changePercent;
        setDisplayChangePercent(changePercent);
      }

      if (changePercent > changeThresholdRef.current) { // Use ref for changeThreshold
        handleActivityDetection();
        captureFrameToBuffer(changePercent);
      }
    }

    setLastFrameData(currentFrameData);
    checkForStability();
  }, [
    streamRef, // Prop
    videoRef,  // Prop
    getFrameDataForComparison,
    calculateChangePercentage,
    handleActivityDetection,
    checkForStability,
    captureFrameToBuffer, // Prop
    pixelDifferenceThreshold, // State (dependency ensures loop is updated if this changes)
    setDisplayChangePercent,
    setLastFrameData,
    // Refs like autoDetectionEnabledRef, changeThresholdRef, lastFrameDataRef are used internally and don't need to be deps for useCallback if the function is stable and reads them
  ]);

  const startMonitoring = useCallback(() => {
    // Check autoDetectionEnabledRef.current directly, not autoDetectionEnabled state, to ensure stability of startMonitoring callback
    if (!autoDetectionEnabledRef.current || isMonitoringRef.current) return;
    
    isMonitoringRef.current = true; // Set ref immediately
    setIsMonitoring(true); // Then set state
    logToUI('[Auto-Detection] 🔄 Monitoring started ...');
    monitoringIntervalRef.current = setInterval(
      monitoringLoop,
      monitoringFrequencyRef.current, // Use ref for frequency
    );
  }, [logToUI, monitoringLoop, setIsMonitoring]); // isMonitoringRef, autoDetectionEnabledRef, monitoringFrequencyRef are read from refs

  const stopMonitoring = useCallback(() => {
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
      monitoringIntervalRef.current = null;
    }
    if (isMonitoringRef.current) { // Check ref
      logToUI('[Auto-Detection] ⏹️ Monitoring stopped');
      isMonitoringRef.current = false; // Set ref
    }
    setIsMonitoring(false); // Then set state
    setLastFrameData(null);
    setActivityDetected(false);
    currentChangePercentRef.current = 0;
    lastDisplayChangeRef.current = 0;
    setDisplayChangePercent(0);
  }, [logToUI, setIsMonitoring, setLastFrameData, setActivityDetected, setDisplayChangePercent]); // isMonitoringRef is read from ref

  useEffect(() => {
    // This effect now uses the 'stream' prop directly and 'autoDetectionEnabled' state from the hook
    if (stream && autoDetectionEnabled) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
    // Cleanup function for when the component unmounts or dependencies change
    return () => {
      stopMonitoring();
    };
  }, [stream, autoDetectionEnabled, startMonitoring, stopMonitoring]);

  return {
    autoDetectionEnabled,
    setAutoDetectionEnabled,
    monitoringFrequency,
    setMonitoringFrequency,
    changeThreshold,
    setChangeThreshold,
    stabilityDelay,
    setStabilityDelay,
    pixelDifferenceThreshold,
    setPixelDifferenceThreshold,
    isMonitoring,
    displayChangePercent,
  };
} 