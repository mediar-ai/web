'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface VideoStepProps {
  videoUrl: string;
  isCompleted: boolean;
  onComplete: () => Promise<number>;
}

export function VideoStep({ videoUrl, isCompleted, onComplete }: VideoStepProps) {
  const [hasWatched, setHasWatched] = useState(isCompleted);
  const [showCredits, setShowCredits] = useState(false);

  const handleMarkWatched = async () => {
    if (hasWatched) return;

    setHasWatched(true);
    const earned = await onComplete();
    if (earned > 0) {
      setShowCredits(true);
      setTimeout(() => setShowCredits(false), 2000);
    }
  };

  // Convert YouTube URL to embed format
  const getEmbedUrl = (url: string) => {
    const videoId = url.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
    )?.[1];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  };

  return (
    <div className="space-y-4">
      {/* YouTube Embed */}
      <div className="relative w-full aspect-video rounded-lg overflow-hidden border-2 border-black">
        <iframe
          src={getEmbedUrl(videoUrl)}
          title="Mediar Introduction"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      </div>

      {/* Mark as Watched Checkbox */}
      <button
        onClick={handleMarkWatched}
        disabled={hasWatched}
        className={cn(
          'w-full flex items-center justify-between p-4 rounded-lg border-2 transition-all duration-200',
          hasWatched
            ? 'border-black bg-gray-50 cursor-default'
            : 'border-gray-200 hover:border-black hover:bg-gray-50 cursor-pointer'
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-6 h-6 rounded border-2 flex items-center justify-center transition-all',
              hasWatched ? 'bg-black border-black' : 'border-gray-300'
            )}
          >
            {hasWatched && <Check className="w-4 h-4 text-white" />}
          </div>
          <span
            className={cn(
              'font-mono text-sm',
              hasWatched ? 'text-gray-500' : 'text-black'
            )}
          >
            I watched the video
          </span>
        </div>

        <span
          className={cn(
            'font-mono text-sm font-medium transition-all duration-300',
            hasWatched ? 'text-green-600' : 'text-amber-500',
            showCredits && 'animate-pulse scale-110'
          )}
        >
          {hasWatched ? '+2 earned' : '+2 credits'}
        </span>
      </button>
    </div>
  );
}
