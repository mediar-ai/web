'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { JsonBlock } from '@/components/ui/code-block';
import { useViewingMode } from '@/hooks/useViewingMode';

interface RawLogItem {
  id: number;
  client_item_id: string;
  server_timestamp: string;
  item_type: string;
  item_data: object;
  user_id: string;
  session_id: string;
}

interface LowLevelLogsTabContentProps {
  onLogsCountChange?: (count: number) => void;
}

export default function LowLevelLogsTabContent({ onLogsCountChange }: LowLevelLogsTabContentProps = {}) {
  const [logs, setLogs] = useState<RawLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewingMode = useViewingMode();

  useEffect(() => {
    const fetchRawLogs = async () => {
      if (viewingMode.type !== 'remote') {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/users/${viewingMode.userId}/raw-data`);
        if (!response.ok) {
          throw new Error('Failed to fetch raw data');
        }
        const data = await response.json();
        setLogs(data);
        if (onLogsCountChange) {
          onLogsCountChange(data.length);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchRawLogs();
  }, [viewingMode, onLogsCountChange]);

  if (loading) {
    return <div>Loading low-level logs...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }
  
  if (logs.length === 0) {
    return <div>No low-level logs found for this user.</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Raw Low-Level Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {new Date(log.server_timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {log.item_type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <JsonBlock
                      data={log.item_data}
                      theme="light"
                      size="sm"
                      showCopy={false}
                      maxHeight="200px"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
} 