import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DebugTabContentProps } from '../../types';

const DebugTabContent: React.FC<DebugTabContentProps> = ({
  frontendLogs,
  copyLogsToClipboard,
  copyStatus,
  clearAllData,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Debug & Logs</CardTitle>
        <CardDescription>
          View raw logs and perform debug actions.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex gap-2'>
          <Button onClick={copyLogsToClipboard} variant='outline'>
            {copyStatus === 'copied' ? 'Copied!' : 'Copy Logs'}
          </Button>
          <Button onClick={clearAllData} variant='destructive'>
            Clear All Local Data
          </Button>
        </div>
        <ScrollArea className='h-[400px] w-full rounded-md border p-4 text-sm font-mono'>
          {frontendLogs.length > 0 ? (
            frontendLogs.map((log, index) => <div key={index}>{log}</div>)
          ) : (
            <p>No logs to display.</p>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default DebugTabContent; 