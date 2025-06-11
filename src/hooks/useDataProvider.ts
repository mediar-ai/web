import { useMemo } from 'react';
import type { DataProvider, ViewingMode } from '@/types';
import { LocalDataProvider, RemoteDataProvider } from '@/lib/dataProviders';

export function useDataProvider(viewingMode: ViewingMode): DataProvider {
  const dataProvider = useMemo(() => {
    if (viewingMode.type === 'local') {
      console.log('[useDataProvider] Using LocalDataProvider');
      return new LocalDataProvider();
    } else {
      console.log('[useDataProvider] Using RemoteDataProvider for user:', viewingMode.userId, 'session:', viewingMode.sessionId);
      if (!viewingMode.userId || !viewingMode.sessionId) {
        throw new Error('RemoteDataProvider requires userId and sessionId');
      }
      return new RemoteDataProvider(viewingMode.userId, viewingMode.sessionId);
    }
  }, [viewingMode.type, viewingMode.userId, viewingMode.sessionId]);

  return dataProvider;
} 