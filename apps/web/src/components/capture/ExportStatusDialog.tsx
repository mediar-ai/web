import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import type { ExportStatusDialogProps } from '../../types'; // Adjust path as necessary

const ExportStatusDialog: React.FC<ExportStatusDialogProps> = ({ exportInProgress }) => {
  return (
    <Dialog open={exportInProgress}>
      <DialogContent
        className='sm:max-w-[425px]'
        onInteractOutside={(event: { preventDefault: () => void; }) => {
          event.preventDefault();
        }}
      >
        <DialogHeader className='text-center'>
          <DialogTitle className='text-xl mb-2'>
            Export in Progress
          </DialogTitle>
          <DialogDescription className='flex flex-col items-center justify-center'>
            <Loader2 className='h-12 w-12 animate-spin text-primary mb-4' />
            Please wait while your data is being exported.
            <br />
            This may take a few moments...
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};

export default ExportStatusDialog; 