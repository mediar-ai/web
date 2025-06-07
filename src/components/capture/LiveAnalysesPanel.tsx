import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RunningAnalysis } from '../../types';

interface LiveAnalysesPanelProps {
  runningAnalyses: RunningAnalysis[];
}

type SortKey = keyof RunningAnalysis;

const LiveAnalysesPanel: React.FC<LiveAnalysesPanelProps> = ({ runningAnalyses }) => {
  const [sortKey, setSortKey] = useState<SortKey>('startTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [timers, setTimers] = useState<Record<string, string>>({});

  useEffect(() => {
    const interval = setInterval(() => {
      const newTimers: Record<string, string> = {};
      runningAnalyses.forEach(analysis => {
        const duration = (Date.now() - analysis.startTime) / 1000;
        newTimers[analysis.id] = duration.toFixed(1) + 's';
      });
      setTimers(newTimers);
    }, 100); // Update timers every 100ms for smoothness

    return () => clearInterval(interval);
  }, [runningAnalyses]);

  const sortedAnalyses = useMemo(() => {
    return [...runningAnalyses].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      let comparison = 0;
      if (aValue > bValue) {
        comparison = 1;
      } else if (aValue < bValue) {
        comparison = -1;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [runningAnalyses, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const renderSortArrow = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  if (runningAnalyses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Live Analyses</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No analyses in progress.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Live Analyses ({runningAnalyses.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('type')} className="-ml-4">
                  Type {renderSortArrow('type')}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('startTime')}>
                  Duration {renderSortArrow('startTime')}
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAnalyses.map((analysis) => (
              <TableRow key={analysis.id}>
                <TableCell className="font-medium">{analysis.type}</TableCell>
                <TableCell>{timers[analysis.id] || '0.0s'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default LiveAnalysesPanel; 