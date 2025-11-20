'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play, Film, Monitor } from 'lucide-react';

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

interface AgentScreenTabProps {
  executionId: number;
}

export function AgentScreenTab({ executionId }: AgentScreenTabProps) {
  const [data, setData] = useState<RecordingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSegmentUrl, setActiveSegmentUrl] = useState<string | null>(null);
  const [initialTime, setInitialTime] = useState<number>(0);

  const getMediaFragment = (filename: string, timeWindowStart: string) => {
    try {
      const executionStart = new Date(timeWindowStart);
      const timeParts = filename.replace('.mp4', '').split('-');
      const [hours, minutes, seconds] = timeParts.map(Number);

      const segmentStart = new Date(executionStart);
      // Assuming filenames are in UTC matching the folder structure
      segmentStart.setUTCHours(hours, minutes, seconds, 0);

      const diffMs = executionStart.getTime() - segmentStart.getTime();

      if (diffMs > 0) {
        return Math.floor(diffMs / 1000);
      }
      return 0;
    } catch (e) {
      return 0;
    }
  };

  useEffect(() => {
    const fetchRecordings = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/api/executions/${executionId}/recording`
        );

        if (!response.ok) {
          // Handle 404 specifically as "no recordings found" rather than a hard error
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

        // Sort recordings by filename (time) just in case
        result.recordings.sort((a, b) => a.filename.localeCompare(b.filename));

        setData(result);

        // Auto-select first recording
        if (result.recordings.length > 0) {
          const firstSegment = result.recordings[0];
          const startTime = getMediaFragment(
            firstSegment.filename,
            result.time_window.start
          );
          setActiveSegmentUrl(firstSegment.url);
          setInitialTime(startTime);
        }
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin border-b-2 border-black rounded-full" />
        <p className="text-sm text-gray-500 font-mono">
          Searching for recording segments...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full">
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center max-w-md">
          <Monitor className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="font-bold text-gray-900 mb-2">
            Recording Unavailable
          </h3>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <p className="text-xs text-gray-400">
            Recordings are usually available for executions on VM agents (e.g.,
            mcp-vm2) that have screen recording enabled.
          </p>
        </div>
      </div>
    );
  }

  if (!data || data.recordings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <p>No recordings found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex items-center justify-between px-1">
        <div>
          <h3 className="font-bold font-mono text-lg">
            Agent Screen Recording
          </h3>
          <p className="text-xs text-gray-500 font-mono">
            Machine: {data.machine} • {data.recordings.length} segment
            {data.recordings.length !== 1 ? 's' : ''} found
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[500px]">
        {/* Main Video Player */}
        <div className="lg:col-span-3 bg-black rounded-lg overflow-hidden flex items-center justify-center border-2 border-black relative shadow-md">
          {activeSegmentUrl ? (
            <video
              key={`${activeSegmentUrl}-${initialTime}`} // Force reload on source change
              className="w-full h-full object-contain"
              controls
              autoPlay={true}
              preload="metadata"
              onLoadedMetadata={e => {
                if (initialTime > 0) {
                  e.currentTarget.currentTime = initialTime;
                }
              }}
            >
              <source src={activeSegmentUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          ) : (
            <div className="text-white text-sm">Select a segment to play</div>
          )}
        </div>

        {/* Playlist / Segments List */}
        <div className="lg:col-span-1 border-2 border-gray-200 rounded-lg overflow-hidden flex flex-col bg-gray-50">
          <div className="p-3 border-b border-gray-200 bg-white">
            <h4 className="font-bold text-sm uppercase">Segments</h4>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {data.recordings.map(segment => {
              // Parse time from filename (e.g. "16-12-45.mp4")
              const timeLabel = segment.filename
                .replace('.mp4', '')
                .replace(/-/g, ':');
              const isActive = activeSegmentUrl === segment.url;

              return (
                <button
                  key={segment.path}
                  onClick={() => {
                    const startTime = getMediaFragment(
                      segment.filename,
                      data.time_window.start
                    );
                    setActiveSegmentUrl(segment.url);
                    setInitialTime(startTime);
                  }}
                  className={`w-full text-left p-3 rounded-md border transition-all duration-200 group ${
                    isActive
                      ? 'bg-black text-white border-black shadow-sm'
                      : 'bg-white text-black border-gray-200 hover:border-black hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-full border shrink-0 ${
                        isActive
                          ? 'border-white/30 bg-white/10'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      {isActive ? (
                        <Play className="w-3 h-3 fill-current" />
                      ) : (
                        <Film className="w-3 h-3 text-gray-400 group-hover:text-black" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-sm truncate">
                        {timeLabel}
                      </p>
                      <p
                        className={`text-xs truncate ${isActive ? 'text-gray-400' : 'text-gray-500'}`}
                      >
                        {(segment.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
