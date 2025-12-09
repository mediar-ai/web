import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ErrorNotificationProps } from '../../types'; // Adjust path as necessary

const ErrorNotification: React.FC<ErrorNotificationProps> = ({ error, showError, dismissError }) => {
  if (!showError || !error) return null;
  return (
    <div
      className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${
        showError
          ? 'translate-y-0 opacity-100'
          : '-translate-y-full opacity-0'
      }`}
    >
      <Card className='bg-destructive/90 border-destructive text-white p-3 shadow-lg backdrop-blur-sm max-w-md'>
        <div className='flex items-center gap-2'>
          <div className='text-sm font-medium'>⚠ {error}</div>
          <Button
            onClick={dismissError}
            size='sm'
            variant='ghost'
            className='h-6 w-6 p-0 text-white hover:bg-white/20 ml-auto'
          >
            ✕
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default ErrorNotification; 