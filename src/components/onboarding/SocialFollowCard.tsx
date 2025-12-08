'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface SocialFollowCardProps {
  platform: 'twitter' | 'github' | 'linkedin' | 'discord';
  icon: React.ReactNode;
  label: string;
  url: string;
  credits: number;
  isCompleted: boolean;
  onComplete: () => Promise<number>;
}

export function SocialFollowCard({
  platform: _platform,
  icon,
  label,
  url,
  credits,
  isCompleted,
  onComplete,
}: SocialFollowCardProps) {
  const [isClicked, setIsClicked] = useState(false);
  const [showCredits, setShowCredits] = useState(false);

  const handleClick = async () => {
    if (isCompleted) return;

    // Open social link in new tab
    window.open(url, '_blank', 'noopener,noreferrer');

    // Mark as completed after a brief delay (give user time to follow)
    setIsClicked(true);

    // Wait a moment then track completion
    setTimeout(async () => {
      const earned = await onComplete();
      if (earned > 0) {
        setShowCredits(true);
        setTimeout(() => setShowCredits(false), 2000);
      }
    }, 500);
  };

  const completed = isCompleted || isClicked;

  return (
    <button
      onClick={handleClick}
      disabled={completed}
      className={cn(
        'w-full flex items-center justify-between p-4 rounded-lg border transition-all duration-200',
        completed
          ? 'border-white/20 bg-white/10 cursor-default'
          : 'border-white/10 hover:border-white/30 hover:bg-white/5 cursor-pointer'
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center',
            completed ? 'bg-white text-black' : 'bg-white/10 text-white'
          )}
        >
          {completed ? <Check className="w-5 h-5" /> : icon}
        </div>
        <span
          className={cn(
            'font-mono text-sm',
            completed ? 'text-gray-400 line-through' : 'text-white'
          )}
        >
          {label}
        </span>
      </div>

      <span
        className={cn(
          'font-mono text-sm font-medium transition-all duration-300',
          completed ? 'text-green-400' : 'text-white',
          showCredits && 'animate-pulse scale-110'
        )}
      >
        {completed ? `+${credits} earned` : `+${credits} credits`}
      </span>
    </button>
  );
}
