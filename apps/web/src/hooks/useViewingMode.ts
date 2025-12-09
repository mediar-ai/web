import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export type ViewingMode =
  | { type: 'local' }
  | { type: 'remote'; userId: string; sessionId?: string; userName?: string };

export function useViewingMode() {
  const [viewingMode, setViewingMode] = useState<ViewingMode>({ type: 'local' });
  const searchParams = useSearchParams();

  useEffect(() => {
    const userId = searchParams.get('userId');
    const sessionId = searchParams.get('sessionId');

    if (userId) {
      console.log(`[useViewingMode] Switched to remote mode for user: ${userId}`);
      // In a real app, you might fetch the user's name here
      setViewingMode({ type: 'remote', userId, sessionId: sessionId || undefined });
    } else {
      console.log(`[useViewingMode] Switched to local mode.`);
      setViewingMode({ type: 'local' });
    }
  }, [searchParams]);

  return viewingMode;
} 