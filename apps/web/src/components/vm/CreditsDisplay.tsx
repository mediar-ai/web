'use client';

import { useState } from 'react';
import { Coins, Plus, History, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { CREDIT_PACKAGES } from '@/lib/credits';
import { cn } from '@/lib/utils';

interface CreditsDisplayProps {
  balance: number;
  onBuyCredits?: (packageId: string) => void;
  showHistory?: boolean;
  className?: string;
}

export function CreditsDisplay({
  balance,
  onBuyCredits,
  showHistory = false,
  className,
}: CreditsDisplayProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleBuyCredits = async (packageId: string) => {
    if (onBuyCredits) {
      onBuyCredits(packageId);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      window.location.href = data.url;
    } catch {
      // Error handling is done in the parent
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="black-outline"
          size="sm"
          className={cn('gap-2 font-mono', className)}
          disabled={isLoading}
        >
          <Coins className="h-4 w-4" />
          <span className="font-bold">{balance}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-mono text-xs uppercase text-gray-500">
          Your Credits
        </DropdownMenuLabel>
        <div className="px-2 py-3 text-center border-b">
          <div className="flex items-center justify-center gap-2">
            <Coins className="h-6 w-6" />
            <span className="text-3xl font-mono font-bold">{balance}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Available credits</p>
        </div>

        <DropdownMenuLabel className="font-mono text-xs uppercase text-gray-500 mt-2">
          Buy More
        </DropdownMenuLabel>
        {CREDIT_PACKAGES.map(pkg => (
          <DropdownMenuItem
            key={pkg.id}
            onClick={() => handleBuyCredits(pkg.id)}
            className="cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <span className="font-mono">{pkg.credits}</span>
                {pkg.popular && (
                  <span className="text-[10px] px-1 bg-black text-white font-mono">
                    BEST
                  </span>
                )}
              </div>
              <span className="font-mono font-bold">${pkg.price}</span>
            </div>
          </DropdownMenuItem>
        ))}

        {showHistory && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => window.location.href = '/settings/billing'}
              className="cursor-pointer"
            >
              <History className="h-4 w-4 mr-2" />
              Transaction History
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
