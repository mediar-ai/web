'use client';

import React, { useState, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';

interface CopyToClipboardButtonProps extends Omit<React.ComponentProps<typeof Button>, 'onClick'> {
  contentToCopy: string;
  children?: ReactNode;
}

export const CopyToClipboardButton: React.FC<CopyToClipboardButtonProps> = ({
  contentToCopy,
  children,
  ...props
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (isCopied) return;

    try {
      await navigator.clipboard.writeText(contentToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      // You might want to show an error state to the user here
    }
  };

  return (
    <Button
      variant="black-outline"
      size="sm"
      className="h-7 px-2"
      onClick={handleCopy}
      {...props}
    >
      {isCopied ? (
        <>
          <Check className="w-3 h-3 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3 h-3 mr-1" />
          {children || 'Copy'}
        </>
      )}
    </Button>
  );
}; 