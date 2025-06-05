import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MemoizedDebugLogsScrollArea from '../common/MemoizedDebugLogsScrollArea';
import type { DebugTabContentProps } from '../../types';

const DebugTabContent: React.FC<DebugTabContentProps> = ({
  frontendLogs,
  copyLogsToClipboard,
  copyStatus,
  clearAllData,
  handleExportAllData,
  exportInProgress,
}) => {
  return (
    <Card className='shadow-sm border-0 p-0 relative'>
      <Button
        onClick={copyLogsToClipboard}
        size='sm'
        variant={copyStatus === 'copied' ? 'default' : 'outline'}
        className={`absolute top-3 right-3 h-7 text-xs z-10 transition-all duration-200 ${
          copyStatus === 'copied'
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : ''
        }`}
      >
        {copyStatus === 'copied' ? '✓ Copied' : 'Copy'}
      </Button>
      <MemoizedDebugLogsScrollArea logs={frontendLogs} />
      <Button
        onClick={clearAllData}
        size='sm'
        variant='destructive'
        className='absolute bottom-3 right-3 h-7 text-xs z-10'
      >
        Erase All Data
      </Button>
      <Button
        onClick={handleExportAllData}
        size='sm'
        variant='outline'
        className='absolute bottom-3 right-[140px] h-7 text-xs z-10' 
        disabled={exportInProgress}
      >
        {exportInProgress ? 'Exporting...' : 'Export All Data'}
      </Button>
    </Card>
  );
};

export default DebugTabContent; 