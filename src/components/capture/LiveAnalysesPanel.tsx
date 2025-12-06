import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RunningAnalysis } from '../../types';

interface LiveAnalysesPanelProps {
  runningAnalyses: RunningAnalysis[];
}

type SortKey = keyof RunningAnalysis | 'timestamp';

const LiveAnalysesPanel: React.FC<LiveAnalysesPanelProps> = ({ runningAnalyses }) => {
  const [sortKey, setSortKey] = useState<SortKey>('startTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [timers, setTimers] = useState<Record<string, string>>({});

  useEffect(() => {
    const interval = setInterval(() => {
      const newTimers: Record<string, string> = {};
      runningAnalyses.filter(a => a.status === 'running' && a.startTime).forEach(analysis => {
        const duration = (Date.now() - analysis.startTime!) / 1000;
        newTimers[analysis.id] = duration.toFixed(1) + 's';
      });
      setTimers(newTimers);
    }, 100); // Update timers every 100ms for smoothness

    return () => clearInterval(interval);
  }, [runningAnalyses]);

  const sortedAnalyses = useMemo(() => {
    return [...runningAnalyses].sort((a, b) => {
      // Always put queued items at the top
      if (a.status === 'queued' && b.status !== 'queued') return -1;
      if (a.status !== 'queued' && b.status === 'queued') return 1;
      
      // Among queued items, show latest first (LIFO)
      if (a.status === 'queued' && b.status === 'queued') {
        // Since queued items don't have startTime, use their position in the array
        // Items added later will have higher indices in the original array
        const aIndex = runningAnalyses.indexOf(a);
        const bIndex = runningAnalyses.indexOf(b);
        return bIndex - aIndex; // Higher index (newer) comes first
      }
      
      // Special handling for sequenceId sorting
      if (sortKey === 'sequenceId') {
        const aSeq = (a.sequenceId || '').replace(/_/g, '-');
        const bSeq = (b.sequenceId || '').replace(/_/g, '-');
        
        // Parse sequence IDs like "1-3" into comparable values
        const [aSession = 0, aShot = 0] = aSeq.split('-').map(Number);
        const [bSession = 0, bShot = 0] = bSeq.split('-').map(Number);
        
        let comparison = 0;
        if (aSession !== bSession) {
          comparison = aSession - bSession;
        } else {
          comparison = aShot - bShot;
        }
        
        return sortDirection === 'asc' ? comparison : -comparison;
      }
      
      // Default sorting for other fields
      const aValue = a[sortKey as keyof RunningAnalysis] ?? 0;
      const bValue = b[sortKey as keyof RunningAnalysis] ?? 0;

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

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const getDuration = (analysis: RunningAnalysis): string => {
    if (analysis.status === 'queued') {
      return 'Queued';
    }
    if (analysis.status === 'running' && analysis.startTime) {
      return timers[analysis.id] || '0.0s';
    }
    if ((analysis.status === 'completed' || analysis.status === 'failed') && analysis.startTime && analysis.endTime) {
      const duration = (analysis.endTime - analysis.startTime) / 1000;
      return duration.toFixed(1) + 's';
    }
    return 'N/A';
  };

  if (runningAnalyses.length === 0) {
    return (
      <Card>
        <CardContent className='pt-4 text-center text-muted-foreground'>
          <p>No LLM analyses yet. Start a capture session to see traces.</p>
          <p className='text-sm mt-2'>Traces will appear here when:</p>
          <ul className='text-sm mt-1'>
            <li>• Screenshots are captured (Auto Detection enabled)</li>
            <li>• Frames are analyzed for UI differences</li>
            <li>• Events are generated from activities</li>
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className='pt-4'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">
                <Button variant="ghost" size="sm" onClick={() => handleSort('sequenceId' as SortKey)} className="-ml-4">
                  ID {renderSortArrow('sequenceId' as SortKey)}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('startTime')} className="-ml-4">
                  Timestamp {renderSortArrow('startTime')}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('type')}>
                  Type {renderSortArrow('type')}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('model')}>
                  Model {renderSortArrow('model')}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('payloadSize')}>
                  Size {renderSortArrow('payloadSize')}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('startTime')}>
                  Duration {renderSortArrow('startTime')}
                </Button>
              </TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" onClick={() => handleSort('status')}>
                  Status {renderSortArrow('status')}
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAnalyses.map((analysis) => (
              <TableRow key={analysis.id}>
                <TableCell className="font-mono text-xs">
                  {analysis.sequenceId ? analysis.sequenceId.replace(/_/g, '-') : '-'}
                </TableCell>
                <TableCell>{analysis.startTime ? new Date(analysis.startTime).toLocaleTimeString() : 'N/A'}</TableCell>
                <TableCell className="font-medium">{analysis.type} [{analysis.payloadType}]</TableCell>
                <TableCell>{analysis.model ? analysis.model.replace('gemini-2.5-flash', 'Flash').replace('gemini-2.5-pro', 'Pro') : 'N/A'}</TableCell>
                <TableCell>
                  {analysis.payloadSize 
                    ? (analysis.payloadType === 'text' 
                        ? `${analysis.payloadSize.toLocaleString()} chars` 
                        : formatBytes(analysis.payloadSize)) 
                    : 'N/A'}
                </TableCell>
                <TableCell>{getDuration(analysis)}</TableCell>
                <TableCell>
                  <span className={`px-2 py-1 rounded text-xs font-medium border-2 ${
                    analysis.status === 'running' ? 'bg-black text-white border-black animate-pulse' :
                    analysis.status === 'failed' ? 'bg-black text-white border-black font-bold' :
                    analysis.status === 'queued' ? 'bg-gray-100 text-gray-800 border-dashed border-gray-400' :
                    'bg-white text-black border-black'
                  }`}>
                    {analysis.status}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default LiveAnalysesPanel; 