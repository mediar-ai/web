'use client';

import { useEffect, useState } from 'react';

interface TimeBoundary {
  startDate: Date | null;
  endDate: Date | null;
}

interface FilteredStats {
  totalEvents: number;
  totalAnalyses: number;
  totalAnnotations: number;
  timeRange: string;
}

interface FilteredStatsDisplayProps {
  userId: string;
  timeBoundary: TimeBoundary;
}

export function FilteredStatsDisplay({ 
  userId, 
  timeBoundary 
}: FilteredStatsDisplayProps) {
  const [filteredStats, setFilteredStats] = useState<FilteredStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFilteredStats = async () => {
      if (!timeBoundary.startDate || !timeBoundary.endDate) {
        setFilteredStats(null);
        return;
      }

      setIsLoadingStats(true);
      setError(null);

      try {
        // Create a new API endpoint for filtered session metadata stats
        const params = new URLSearchParams({
          startDate: timeBoundary.startDate.toISOString(),
          endDate: timeBoundary.endDate.toISOString(),
          userId: userId
        });

        const response = await fetch(`/api/sessions/filtered-stats?${params}`);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch filtered stats: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Format time range for display
        const startStr = timeBoundary.startDate.toLocaleDateString() + ' ' + 
                         timeBoundary.startDate.toLocaleTimeString();
        const endStr = timeBoundary.endDate.toLocaleDateString() + ' ' + 
                       timeBoundary.endDate.toLocaleTimeString();
        
        setFilteredStats({
          totalEvents: data.totalEvents || 0,
          totalAnalyses: data.totalAnalyses || 0,
          totalAnnotations: data.totalAnnotations || 0,
          timeRange: `${startStr} - ${endStr}`
        });
      } catch (err) {
        console.error('Error fetching filtered stats:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setIsLoadingStats(false);
      }
    };

    fetchFilteredStats();
  }, [userId, timeBoundary]);

  if (!timeBoundary.startDate || !timeBoundary.endDate) {
    return null;
  }

  if (isLoadingStats) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Loading filtered stats...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-black p-4 border border-black rounded-lg bg-gray-100">
        <p className="text-sm">Error loading stats: {error}</p>
      </div>
    );
  }

  if (!filteredStats) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-1">Filtered Data Stats</h3>
        <p className="text-xs text-muted-foreground">{filteredStats.timeRange}</p>
      </div>
      
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div className="bg-white border border-black p-3 rounded-lg">
          <p className="text-muted-foreground">Raw Events</p>
          <p className="font-bold text-2xl">{filteredStats.totalEvents.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Events in selected timeframe
          </p>
        </div>
        <div className="bg-white border border-black p-3 rounded-lg">
          <p className="text-muted-foreground">Analyses</p>
          <p className="font-bold text-2xl">{filteredStats.totalAnalyses.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Workflow analyses generated
          </p>
        </div>
        <div className="bg-white border border-black p-3 rounded-lg">
          <p className="text-muted-foreground">Annotations</p>
          <p className="font-bold text-2xl">{filteredStats.totalAnnotations.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Timeline annotations created
          </p>
        </div>
      </div>

      {filteredStats.totalEvents === 0 && (
        <div className="text-center text-black bg-gray-100 border border-black rounded-lg p-3">
          <p className="text-sm">No events found in the selected time range. Try expanding the time window.</p>
        </div>
      )}
    </div>
  );
} 