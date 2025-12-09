'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Monitor,
  Calendar,
  Clock,
  Film,
  AlertCircle,
  Info,
  AlertTriangle,
  Database,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

interface RecordingSegment {
  filename: string;
  path: string;
  url: string;
  size: number;
  lastModified: string;
}

interface ProcessedSegment extends RecordingSegment {
  startTimeOffset: number;
  estimatedDuration: number;
  endTimeOffset: number;
  label: string;
}

interface LogEntry {
  Timestamp: string;
  ScopeName: string;
  Body: string;
  SeverityText: string;
  ServiceName: string;
  HostName?: string;
  TraceId?: string;
  SpanId?: string;
  timeOffset: number; // Calculated offset in seconds from video start
}

interface Machine {
  id: string;
  name: string;
  status: string;
  health_status: string;
}

const formatDuration = (seconds: number) => {
  if (isNaN(seconds)) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatTimeOfDay = (offsetSeconds: number, startTime: string | null) => {
  if (!startTime || isNaN(offsetSeconds)) return '--:--:--';

  try {
    const startDate = new Date(startTime);
    const currentTime = new Date(startDate.getTime() + offsetSeconds * 1000);

    return currentTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch (e) {
    return '--:--:--';
  }
};

const formatTimeCompact = (timestamp: string) => {
  if (!timestamp || timestamp === '') return 'N/A';
  const utcTimestamp = timestamp.includes('Z')
    ? timestamp
    : timestamp.replace(' ', 'T') + 'Z';
  const date = new Date(utcTimestamp);
  if (isNaN(date.getTime())) return 'Invalid';

  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case 'ERROR':
    case 'FATAL':
      return <AlertCircle className="w-3 h-3" />;
    case 'WARN':
      return <AlertTriangle className="w-3 h-3" />;
    default:
      return <Info className="w-3 h-3" />;
  }
};

const getSeverityClass = (severity: string) => {
  switch (severity) {
    case 'ERROR':
    case 'FATAL':
      return 'border-2 border-black bg-black text-white font-bold';
    case 'WARN':
      return 'border-2 border-gray-400 bg-gray-200 text-gray-900';
    case 'DEBUG':
      return 'border border-gray-300 bg-gray-100 text-gray-600';
    default:
      return 'border border-gray-300 bg-white text-black';
  }
};

export default function InternalDebugPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();

  // Machine selection
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Data state
  const [recordings, setRecordings] = useState<RecordingSegment[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [activeSegment, setActiveSegment] = useState<ProcessedSegment | null>(
    null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [globalTime, setGlobalTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch machines on mount
  useEffect(() => {
    const fetchMachines = async () => {
      try {
        const response = await fetch('/api/machines?show_all=true');
        if (response.ok) {
          const data = await response.json();
          setMachines(data.machines || []);
        }
      } catch (err) {
        console.error('Error fetching machines:', err);
      }
    };

    if (isLoaded && userId) {
      fetchMachines();
    }
  }, [isLoaded, userId]);

  // Fetch recordings and logs when machine/date changes
  useEffect(() => {
    const fetchData = async () => {
      if (!selectedMachine || !selectedDate) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch recordings
        const recordingsResponse = await fetch(
          `/api/internal/vm-recordings?machine=${selectedMachine}&date=${selectedDate}`
        );

        if (!recordingsResponse.ok) {
          if (recordingsResponse.status === 404) {
            setError('No recordings found for this machine and date.');
          } else {
            const errData = await recordingsResponse.json().catch(() => ({}));
            setError(errData.error || 'Failed to load recordings');
          }
          setRecordings([]);
          setLogs([]);
          return;
        }

        const recordingsData = await recordingsResponse.json();
        const sortedRecordings = (recordingsData.recordings || []).sort(
          (a: RecordingSegment, b: RecordingSegment) =>
            a.filename.localeCompare(b.filename)
        );
        setRecordings(sortedRecordings);

        // Fetch logs for the machine using the actual computer name from recordings response
        // ClickHouse logs use HostName which is the Windows COMPUTERNAME
        const computerName = recordingsData.computer_name || selectedMachine;
        console.log('[Debug Page] Fetching logs for computer name:', computerName);

        const logsResponse = await fetch(
          `/api/observability/logs?hours=48&service=${encodeURIComponent(computerName)}`
        );

        if (logsResponse.ok) {
          const logsData = await logsResponse.json();
          console.log('[Debug Page] Received logs:', logsData.logs?.length || 0);
          setLogs(logsData.logs || []);
        } else {
          console.error('Failed to fetch logs');
          setLogs([]);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('An unexpected error occurred while loading data.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedMachine, selectedDate]);

  // Process segments & calculate timeline
  const { segments, totalDuration, startTime } = useMemo(() => {
    if (recordings.length === 0) {
      return { segments: [], totalDuration: 0, startTime: null };
    }

    // Use the date + first recording time as the start reference
    const dateStr = selectedDate;
    const processed: ProcessedSegment[] = [];

    // Parse first recording to establish timeline start
    const firstRec = recordings[0];
    const firstTimeParts = firstRec.filename.replace('.mp4', '').split('-');
    const [firstH, firstM, firstS] = firstTimeParts.map(Number);

    const timelineStart = new Date(`${dateStr}T00:00:00Z`);
    timelineStart.setUTCHours(firstH, firstM, firstS, 0);

    for (let i = 0; i < recordings.length; i++) {
      const rec = recordings[i];
      const timeParts = rec.filename.replace('.mp4', '').split('-');
      const [hours, minutes, seconds] = timeParts.map(Number);

      const segmentDate = new Date(`${dateStr}T00:00:00Z`);
      segmentDate.setUTCHours(hours, minutes, seconds, 0);

      const diffSeconds = Math.floor(
        (segmentDate.getTime() - timelineStart.getTime()) / 1000
      );

      // Estimate duration
      let duration = 0;
      if (i < recordings.length - 1) {
        const nextRec = recordings[i + 1];
        const nextTimeParts = nextRec.filename.replace('.mp4', '').split('-');
        const [nh, nm, ns] = nextTimeParts.map(Number);
        const nextDate = new Date(`${dateStr}T00:00:00Z`);
        nextDate.setUTCHours(nh, nm, ns, 0);
        duration = Math.floor(
          (nextDate.getTime() - segmentDate.getTime()) / 1000
        );
      } else {
        duration = 600; // Default 10 minutes for last segment
      }

      processed.push({
        ...rec,
        startTimeOffset: diffSeconds,
        estimatedDuration: duration,
        endTimeOffset: diffSeconds + duration,
        label: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      });
    }

    const lastSeg = processed[processed.length - 1];
    const calculatedDuration = lastSeg.endTimeOffset + 60;

    return {
      segments: processed,
      totalDuration: calculatedDuration,
      startTime: timelineStart.toISOString(),
    };
  }, [recordings, selectedDate]);

  // Process logs with time offsets relative to video timeline
  const processedLogs = useMemo(() => {
    if (!startTime || logs.length === 0) return [];

    const videoStartTime = new Date(startTime).getTime();

    return logs
      .map(log => {
        const logTimestamp = log.Timestamp.includes('Z')
          ? log.Timestamp
          : log.Timestamp.replace(' ', 'T') + 'Z';
        const logTime = new Date(logTimestamp).getTime();
        const timeOffset = (logTime - videoStartTime) / 1000; // seconds

        return {
          ...log,
          timeOffset,
        };
      })
      .filter(log => log.timeOffset >= 0 && log.timeOffset <= totalDuration)
      .sort((a, b) => b.timeOffset - a.timeOffset); // Newest first (reverse chronological)
  }, [logs, startTime, totalDuration]);

  // Initialize first segment
  useEffect(() => {
    if (segments.length > 0 && !activeSegment) {
      setActiveSegment(segments[0]);
      setGlobalTime(segments[0].startTimeOffset);
    }
  }, [segments, activeSegment]);

  // Video event handlers
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

  // Scrubbing logic
  const handleScrub = (value: number[]) => {
    const newTime = value[0];

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
      const nextSegment = segments.find(s => s.startTimeOffset > newTime);
      if (nextSegment) {
        setGlobalTime(nextSegment.startTimeOffset);
        setActiveSegment(nextSegment);
      } else {
        setGlobalTime(newTime);
      }
    }
  };

  // Sync video element
  useEffect(() => {
    if (videoRef.current && activeSegment) {
      const offset = globalTime - activeSegment.startTimeOffset;
      if (offset >= 0 && Math.abs(videoRef.current.currentTime - offset) > 1) {
        if (videoRef.current.readyState >= 1) {
          videoRef.current.currentTime = offset;
        }
      }
      videoRef.current.playbackRate = playbackSpeed;

      if (isPlaying) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  }, [activeSegment, globalTime, isPlaying, playbackSpeed]);

  // Auto-scroll logs to current time (only when enabled)
  useEffect(() => {
    if (!autoScrollEnabled || !logsScrollRef.current || processedLogs.length === 0) return;

    // Find the first log where timeOffset <= globalTime (since logs are sorted newest-first)
    const currentLogIndex = processedLogs.findIndex(
      log => log.timeOffset <= globalTime
    );

    if (currentLogIndex >= 0) {
      const logElements = logsScrollRef.current.querySelectorAll(
        '[data-log-index]'
      );
      const targetElement = logElements[currentLogIndex] as HTMLElement;

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [globalTime, processedLogs, autoScrollEnabled]);

  // Detect manual scrolling and disable auto-scroll temporarily
  useEffect(() => {
    const scrollContainer = logsScrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // User is manually scrolling - disable auto-scroll
      setAutoScrollEnabled(false);

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Re-enable auto-scroll after 3 seconds of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        setAutoScrollEnabled(true);
      }, 3000);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Check access
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const response = await fetch(
          '/api/observability/telemetry?metric=overview&hours=1'
        );
        if (response.status === 403) {
          router.push('/unauthorized');
        }
      } catch (error) {
        console.error('Access check failed:', error);
      }
    };

    if (isLoaded && userId) {
      checkAccess();
    }
  }, [isLoaded, userId, router]);

  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <div className="flex items-center justify-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-black" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="font-mono font-bold text-3xl mb-2 flex items-center gap-2">
              <Monitor className="w-8 h-8" />
              VM Timeline Debug
            </h1>
            <p className="font-mono text-gray-600 mb-4">
              Internal debugging tool - VM screen recordings synced with logs
            </p>

            {/* Machine & Date Selectors */}
            <div className="flex items-center gap-3">
              <select
                value={selectedMachine}
                onChange={e => setSelectedMachine(e.target.value)}
                className="px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="">Select VM...</option>
                {machines.map(machine => (
                  <option key={machine.id} value={machine.name}>
                    {machine.name} ({machine.status})
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>

          {/* Error State */}
          {error && (
            <div className="border-2 border-black p-4 bg-gray-50 mb-4">
              <p className="font-mono text-sm text-gray-800">{error}</p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center h-96 space-y-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
              <Loader2 className="w-8 h-8 animate-spin text-black" />
              <p className="text-sm text-gray-500 font-mono uppercase tracking-widest">
                Loading Timeline...
              </p>
            </div>
          )}

          {/* Main Content */}
          {!loading && !error && selectedMachine && segments.length > 0 && (
            <div className="space-y-4">
              {/* Video Player */}
              <div className="border-2 border-black bg-white overflow-hidden">
                {/* Video Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-black text-white border-b border-black">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
                      <h3 className="font-mono font-bold text-sm tracking-wide uppercase">
                        REPLAY // {selectedMachine}
                      </h3>
                    </div>
                    <div className="h-4 w-px bg-gray-700" />
                    <div className="flex items-center space-x-2 text-xs text-gray-400 font-mono">
                      <Calendar className="w-3 h-3" />
                      <span>{selectedDate}</span>
                      {startTime && (
                        <>
                          <Clock className="w-3 h-3 ml-2" />
                          <span>
                            {new Date(startTime).toLocaleTimeString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 text-xs font-mono">
                    <Film className="w-4 h-4" />
                    <span>{segments.length} segments</span>
                  </div>
                </div>

                {/* Video Display */}
                <div className="relative bg-black flex items-center justify-center overflow-hidden group h-96">
                  {activeSegment ? (
                    <video
                      ref={videoRef}
                      key={activeSegment.url}
                      src={activeSegment.url}
                      className="w-full h-full object-contain"
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={handleVideoEnded}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onClick={() => setIsPlaying(!isPlaying)}
                      onLoadedMetadata={e => {
                        if (activeSegment) {
                          const offset =
                            globalTime - activeSegment.startTimeOffset;
                          if (offset > 0) {
                            e.currentTarget.currentTime = offset;
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className="text-gray-500 font-mono text-sm">
                      NO SIGNAL
                    </div>
                  )}

                  {/* Play Button Overlay */}
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

                {/* Timeline & Controls */}
                <div className="h-24 bg-white border-t-2 border-black p-4 flex flex-col justify-center space-y-3">
                  {/* Timeline Scrubber */}
                  <div className="flex items-center space-x-4">
                    <div className="w-24 font-mono text-xs font-bold text-right tabular-nums">
                      {formatTimeOfDay(globalTime, startTime)}
                    </div>

                    <div className="flex-1 relative h-6 flex items-center">
                      {/* Timeline Background */}
                      <div className="absolute inset-0 flex items-center">
                        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden relative border border-gray-200">
                          {segments.map(seg => {
                            const leftPct =
                              (seg.startTimeOffset / totalDuration) * 100;
                            const widthPct =
                              (seg.estimatedDuration / totalDuration) * 100;
                            const isActive =
                              activeSegment?.filename === seg.filename;
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

                      {/* Slider */}
                      <Slider
                        value={[globalTime]}
                        min={0}
                        max={totalDuration}
                        step={1}
                        onValueChange={handleScrub}
                        className="relative z-10 cursor-pointer"
                      />
                    </div>

                    <div className="w-24 font-mono text-xs text-gray-500 tabular-nums">
                      {formatTimeOfDay(totalDuration, startTime)}
                    </div>
                  </div>

                  {/* Playback Controls */}
                  <div className="flex items-center justify-center space-x-6">
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full border-2 border-gray-200 hover:border-black hover:bg-gray-50"
                        onClick={() =>
                          setGlobalTime(Math.max(0, globalTime - 10))
                        }
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
                          setGlobalTime(
                            Math.min(totalDuration, globalTime + 10)
                          )
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

              {/* Logs Panel */}
              <div className="border-2 border-black bg-white">
                <div className="px-4 py-3 bg-black text-white border-b border-black">
                  <h3 className="font-mono font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    LOGS ({processedLogs.length})
                  </h3>
                </div>

                <ScrollArea className="h-96" ref={logsScrollRef}>
                  <div className="p-2 space-y-1">
                    {processedLogs.length === 0 ? (
                      <div className="text-center py-8 font-mono text-sm text-gray-600">
                        No logs found for this time window
                      </div>
                    ) : (
                      processedLogs.map((log, i) => {
                        const severity = log.SeverityText || 'INFO';
                        const isActive =
                          globalTime >= log.timeOffset &&
                          globalTime < log.timeOffset + 1;

                        return (
                          <button
                            key={i}
                            data-log-index={i}
                            onClick={() => {
                              // Jump video to this log's timestamp
                              handleScrub([log.timeOffset]);
                              setIsPlaying(true);
                              // Re-enable auto-scroll when clicking a log
                              setAutoScrollEnabled(true);
                            }}
                            className={cn(
                              'w-full text-left border p-2 font-mono text-xs transition-all cursor-pointer',
                              isActive
                                ? 'border-2 border-black bg-yellow-50'
                                : 'border-gray-300 hover:border-black hover:bg-gray-50'
                            )}
                          >
                            <div className="flex items-center gap-3">
                              {/* Timeline offset */}
                              <span className="text-gray-500 w-16 flex-shrink-0 font-bold">
                                {formatDuration(log.timeOffset)}
                              </span>

                              {/* Time */}
                              <span className="text-gray-500 w-20 flex-shrink-0">
                                {formatTimeCompact(log.Timestamp)}
                              </span>

                              {/* Severity */}
                              <span
                                className={`px-2 py-0.5 rounded-sm flex items-center gap-1 ${getSeverityClass(severity)} flex-shrink-0`}
                              >
                                {getSeverityIcon(severity)}
                                {severity}
                              </span>

                              {/* Message */}
                              <span className="flex-1 truncate text-black">
                                {log.Body}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
