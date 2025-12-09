'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Monitor,
  List,
  Clock,
  Film,
  Calendar,
  HardDrive,
  Radio,
  Video,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LiveVncView } from './LiveVncView';

interface RecordingSegment {
  filename: string;
  path: string;
  url: string;
  size: number;
  lastModified: string;
}

interface RecordingResponse {
  execution_id: string;
  machine: string;
  time_window: {
    start: string;
    end: string;
  };
  recordings: RecordingSegment[];
}

interface ProcessedSegment extends RecordingSegment {
  startTimeOffset: number; // Seconds from execution start
  estimatedDuration: number; // Seconds
  endTimeOffset: number; // Seconds from execution start
  label: string;
}

interface AgentScreenTabProps {
  executionId: number;
  machineId?: number;
  isLive?: boolean;
}


// Helper to format seconds to HH:MM:SS
const formatDuration = (seconds: number) => {
  if (isNaN(seconds)) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export function AgentScreenTab({ executionId, machineId, isLive = false }: AgentScreenTabProps) {
  const [activeTab, setActiveTab] = useState<"live" | "recording">(isLive && machineId ? "live" : "recording");

  // If machine has VNC, show tabs
  if (machineId) {
    return (
      <div className="h-full flex flex-col">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "live" | "recording")} className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-2 mb-2">
            <TabsTrigger value="live" className="font-mono text-xs"><Radio className="w-3 h-3 mr-2" />LIVE</TabsTrigger>
            <TabsTrigger value="recording" className="font-mono text-xs"><Video className="w-3 h-3 mr-2" />RECORDING</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="flex-1 mt-0"><LiveVncView machineId={machineId} /></TabsContent>
          <TabsContent value="recording" className="flex-1 mt-0"><RecordingView executionId={executionId} /></TabsContent>
        </Tabs>
      </div>
    );
  }

  // Original recording-only view
  return <RecordingView executionId={executionId} />;
}

// Recording view component (original AgentScreenTab logic)
function RecordingView({ executionId }: { executionId: number }) {
  // Data State
  const [data, setData] = useState<RecordingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Playback State
  const [activeSegment, setActiveSegment] = useState<ProcessedSegment | null>(
    null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [globalTime, setGlobalTime] = useState(0); // Current time in seconds from start of execution window
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSidebar, setShowSidebar] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Fetch Data
  useEffect(() => {
    const fetchRecordings = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/executions/${executionId}/recording`
        );

        if (!response.ok) {
          if (response.status === 404) {
            setError(
              'No screen recordings found for this execution time window.'
            );
          } else {
            const errData = await response.json().catch(() => ({}));
            setError(errData.error || 'Failed to load recordings');
          }
          return;
        }

        const result: RecordingResponse = await response.json();
        // Sort by filename (time)
        result.recordings.sort((a, b) => a.filename.localeCompare(b.filename));
        setData(result);
      } catch (err) {
        console.error('Error fetching recordings:', err);
        setError('An unexpected error occurred while loading recordings.');
      } finally {
        setLoading(false);
      }
    };

    if (executionId) {
      fetchRecordings();
    }
  }, [executionId]);

  // Process Segments & Calculate Timeline
  const { segments, totalDuration, startTime } = useMemo(() => {
    if (!data || data.recordings.length === 0) {
      return { segments: [], totalDuration: 0, startTime: null };
    }

    const executionStart = new Date(data.time_window.start).getTime();
    const executionEnd = new Date(data.time_window.end).getTime();
    // Fallback duration if end time is missing or invalid
    const maxDuration =
      executionEnd > executionStart
        ? (executionEnd - executionStart) / 1000
        : 3600; // Default 1h

    const processed: ProcessedSegment[] = [];

    for (let i = 0; i < data.recordings.length; i++) {
      const rec = data.recordings[i];
      const timeParts = rec.filename.replace('.mp4', '').split('-');
      const [hours, minutes, seconds] = timeParts.map(Number);

      // Calculate start time based on filename
      // Assumes filename matches UTC time of day
      const segmentDate = new Date(data.time_window.start);
      segmentDate.setUTCHours(hours, minutes, seconds, 0);

      let diffSeconds = Math.floor(
        (segmentDate.getTime() - executionStart) / 1000
      );
      if (diffSeconds < 0) diffSeconds = 0; // Clamp

      // Estimate duration: distance to next segment or end of window
      let duration = 0;
      if (i < data.recordings.length - 1) {
        const nextRec = data.recordings[i + 1];
        const nextTimeParts = nextRec.filename.replace('.mp4', '').split('-');
        const [nh, nm, ns] = nextTimeParts.map(Number);
        const nextDate = new Date(data.time_window.start);
        nextDate.setUTCHours(nh, nm, ns, 0);
        duration = Math.floor(
          (nextDate.getTime() - segmentDate.getTime()) / 1000
        );
      } else {
        // Last segment
        duration = Math.floor((executionEnd - segmentDate.getTime()) / 1000);
        // Sanity check: if calculation is weird, give it 10 mins or until logical end
        if (duration <= 0 || duration > 3600 * 24) duration = 600;
      }

      processed.push({
        ...rec,
        startTimeOffset: diffSeconds,
        estimatedDuration: duration,
        endTimeOffset: diffSeconds + duration,
        label: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      });
    }

    // Adjust total duration to include the last segment's full length
    const lastSeg = processed[processed.length - 1];
    const calculatedDuration = Math.max(
      maxDuration,
      lastSeg.endTimeOffset + 60
    );

    return {
      segments: processed,
      totalDuration: calculatedDuration,
      startTime: data.time_window.start,
    };
  }, [data]);

  // Initialize first segment
  useEffect(() => {
    if (segments.length > 0 && !activeSegment) {
      setActiveSegment(segments[0]);
      setGlobalTime(segments[0].startTimeOffset);
    }
  }, [segments, activeSegment]);

  // Video Event Handlers
  const handleTimeUpdate = () => {
    if (videoRef.current && activeSegment) {
      const currentVideoTime = videoRef.current.currentTime;
      setGlobalTime(activeSegment.startTimeOffset + currentVideoTime);
    }
  };

  const handleVideoEnded = () => {
    if (!activeSegment) return;
    const currentIndex = segments.findIndex(
      s => s.filename === activeSegment.filename
    );
    if (currentIndex < segments.length - 1) {
      const nextSegment = segments[currentIndex + 1];
      setActiveSegment(nextSegment);
      setGlobalTime(nextSegment.startTimeOffset);
    } else {
      setIsPlaying(false);
    }
  };

  // Scrubbing Logic
  const handleScrub = (value: number[]) => {
    const newTime = value[0];

    // Find which segment covers this time
    const foundSegment = segments.find(
      s => newTime >= s.startTimeOffset && newTime < s.endTimeOffset
    );

    if (foundSegment) {
      setGlobalTime(newTime);
      if (foundSegment.filename !== activeSegment?.filename) {
        setActiveSegment(foundSegment);
      } else if (videoRef.current) {
        const offset = newTime - foundSegment.startTimeOffset;
        if (Math.abs(videoRef.current.currentTime - offset) > 0.5) {
          videoRef.current.currentTime = offset;
        }
      }
    } else {
      // In a gap - snap to next segment start
      const nextSegment = segments.find(s => s.startTimeOffset > newTime);
      if (nextSegment) {
        setGlobalTime(nextSegment.startTimeOffset);
        setActiveSegment(nextSegment);
      } else {
        setGlobalTime(newTime);
      }
    }
  };

  // Sync Video Element when Active Segment Changes or Scrubbing requires seeking in new segment
  useEffect(() => {
    if (videoRef.current && activeSegment) {
      // If the global time is within this segment, seek to correct offset
      const offset = globalTime - activeSegment.startTimeOffset;
      if (offset >= 0 && Math.abs(videoRef.current.currentTime - offset) > 1) {
        if (videoRef.current.readyState >= 1) {
          videoRef.current.currentTime = offset;
        }
      }
      // Playback speed
      videoRef.current.playbackRate = playbackSpeed;

      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [activeSegment, globalTime, isPlaying, playbackSpeed]);

  // Loading State
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[500px] space-y-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
        <Loader2 className="w-8 h-8 animate-spin text-black" />
        <p className="text-sm text-gray-500 font-mono uppercase tracking-widest">
          Loading Timeline...
        </p>
      </div>
    );
  }

  // Error State
  if (error || !data || segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[500px] space-y-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 p-8">
        <div className="bg-white p-4 rounded-full border-2 border-black shadow-sm">
          <Monitor className="w-8 h-8 text-gray-400" />
        </div>
        <div className="text-center max-w-md">
          <h3 className="font-bold text-gray-900 mb-2 font-mono uppercase">
            No Signal
          </h3>
          <p className="text-sm text-gray-500 mb-6">
            {error || 'No recording segments found for this execution.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border-2 border-black rounded-lg overflow-hidden shadow-sm">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-black">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
            <h3 className="font-mono font-bold text-sm tracking-wide uppercase">
              REPLAY // {data.machine}
            </h3>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div className="flex items-center space-x-2 text-xs text-gray-400 font-mono">
            <Calendar className="w-3 h-3" />
            <span>{new Date(startTime || '').toLocaleDateString()}</span>
            <Clock className="w-3 h-3 ml-2" />
            <span>
              {new Date(data.time_window.start).toLocaleTimeString()} -{' '}
              {new Date(data.time_window.end).toLocaleTimeString()}
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-gray-800 hover:text-white"
                  onClick={() => setShowSidebar(!showSidebar)}
                >
                  <List className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-mono text-xs">Toggle Segment List</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Video Area */}
        <div className="flex-1 flex flex-col bg-gray-100 relative">
          {/* Video Player */}
          <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden group">
            {activeSegment ? (
              <video
                ref={videoRef}
                key={activeSegment.url} // Force reload on segment change
                src={activeSegment.url}
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleVideoEnded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onClick={() => setIsPlaying(!isPlaying)}
                onLoadedMetadata={e => {
                  if (activeSegment) {
                    const offset = globalTime - activeSegment.startTimeOffset;
                    if (offset > 0) {
                      e.currentTarget.currentTime = offset;
                    }
                  }
                }}
              />
            ) : (
              <div className="text-gray-500 font-mono text-sm">
                NO SIGNAL AT CURRENT TIME
              </div>
            )}

            {/* Center Play Button Overlay */}
            {!isPlaying && activeSegment && (
              <button
                onClick={() => setIsPlaying(true)}
                className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-all"
              >
                <div className="bg-white text-black p-4 rounded-full shadow-lg transform group-hover:scale-110 transition-transform duration-200">
                  <Play className="w-8 h-8 fill-current ml-1" />
                </div>
              </button>
            )}
          </div>

          {/* Timeline / Controls Bar */}
          <div className="h-24 bg-white border-t-2 border-black p-4 flex flex-col justify-center space-y-3 z-10">
            {/* Time Display & Scrubber */}
            <div className="flex items-center space-x-4">
              <div className="w-20 font-mono text-xs font-bold text-right tabular-nums">
                {formatDuration(globalTime)}
              </div>

              <div className="flex-1 relative h-6 flex items-center">
                {/* Timeline Visualization Background */}
                <div className="absolute inset-0 flex items-center">
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden relative border border-gray-200">
                    {segments.map(seg => {
                      const leftPct =
                        (seg.startTimeOffset / totalDuration) * 100;
                      const widthPct =
                        (seg.estimatedDuration / totalDuration) * 100;
                      const isActive = activeSegment?.filename === seg.filename;
                      return (
                        <div
                          key={seg.filename}
                          className={cn(
                            'absolute top-0 bottom-0 transition-colors duration-200',
                            isActive
                              ? 'bg-black'
                              : 'bg-gray-400 hover:bg-gray-600'
                          )}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                          }}
                          title={`Segment: ${seg.label}`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Interactive Slider */}
                <Slider
                  value={[globalTime]}
                  min={0}
                  max={totalDuration}
                  step={1}
                  onValueChange={handleScrub}
                  className="relative z-10 cursor-pointer"
                />
              </div>

              <div className="w-20 font-mono text-xs text-gray-500 tabular-nums">
                {formatDuration(totalDuration)}
              </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-center space-x-6">
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full border-2 border-gray-200 hover:border-black hover:bg-gray-50"
                  onClick={() => setGlobalTime(Math.max(0, globalTime - 10))}
                >
                  <SkipBack className="w-3 h-3" />
                </Button>
                <Button
                  className={cn(
                    'h-10 w-10 rounded-full border-2 border-black flex items-center justify-center transition-all',
                    isPlaying
                      ? 'bg-white text-black hover:bg-gray-100'
                      : 'bg-black text-white hover:bg-gray-800'
                  )}
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full border-2 border-gray-200 hover:border-black hover:bg-gray-50"
                  onClick={() =>
                    setGlobalTime(Math.min(totalDuration, globalTime + 10))
                  }
                >
                  <SkipForward className="w-3 h-3" />
                </Button>
              </div>

              <div className="h-4 w-px bg-gray-300" />

              <div className="flex items-center space-x-1">
                {[0.5, 1, 1.5, 2].map(rate => (
                  <button
                    key={rate}
                    onClick={() => setPlaybackSpeed(rate)}
                    className={cn(
                      'px-2 py-1 text-[10px] font-mono font-bold rounded border border-transparent transition-all',
                      playbackSpeed === rate
                        ? 'bg-black text-white'
                        : 'text-gray-500 hover:bg-gray-100 hover:border-gray-200'
                    )}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar (Collapsible) */}
        {showSidebar && (
          <div className="w-80 bg-gray-50 border-l-2 border-black flex flex-col shadow-xl z-20 animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-gray-200 bg-white">
              <h4 className="font-bold font-mono text-xs uppercase tracking-wider">
                Segments ({segments.length})
              </h4>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {segments.map(seg => {
                  const isActive = activeSegment?.filename === seg.filename;
                  return (
                    <button
                      key={seg.filename}
                      onClick={() => {
                        setActiveSegment(seg);
                        setGlobalTime(seg.startTimeOffset);
                        setIsPlaying(true);
                      }}
                      className={cn(
                        'w-full text-left p-3 rounded-md border-2 transition-all duration-200 group',
                        isActive
                          ? 'bg-black text-white border-black shadow-md'
                          : 'bg-white text-black border-transparent hover:border-gray-300 hover:bg-gray-100'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-full border shrink-0',
                            isActive
                              ? 'border-white/30 bg-white/10'
                              : 'border-gray-200 bg-white'
                          )}
                        >
                          {isActive ? (
                            <Play className="w-3 h-3 fill-current" />
                          ) : (
                            <Film className="w-3 h-3 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline">
                            <p className="font-mono font-bold text-sm">
                              {seg.label}
                            </p>
                            <p
                              className={cn(
                                'text-[10px] font-mono',
                                isActive ? 'text-gray-400' : 'text-gray-400'
                              )}
                            >
                              {formatDuration(seg.estimatedDuration)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <HardDrive className="w-3 h-3 opacity-50" />
                            <p
                              className={cn(
                                'text-xs truncate',
                                isActive ? 'text-gray-300' : 'text-gray-500'
                              )}
                            >
                              {(seg.size / 1024 / 1024).toFixed(1)} MB
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
