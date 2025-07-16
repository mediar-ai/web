import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface ProcessingLock {
  status: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  event_id: string;
}

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
    
    // Get processing statistics
    // Get basic counts by status
    const { data: locks, error: locksError } = await supabase
      .from('processing_locks')
      .select('status, created_at, updated_at, user_id, event_id')
      .order('updated_at', { ascending: false });
    
    if (locksError) {
      console.error('Error fetching processing locks:', locksError);
      throw new Error('Failed to fetch processing locks');
    }
    
    // Group by status
    const locksByStatus = (locks || []).reduce((acc: Record<string, ProcessingLock[]>, lock: ProcessingLock) => {
      if (!acc[lock.status]) acc[lock.status] = [];
      acc[lock.status].push(lock);
      return acc;
    }, {} as Record<string, ProcessingLock[]>);
    
    // Calculate basic counts
    const totalProcessed = locksByStatus['completed']?.length || 0;
    const totalFailed = locksByStatus['failed']?.length || 0;
    
    // Calculate ages and additional metrics
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const processedToday = locksByStatus['completed']?.filter((lock: ProcessingLock) => 
      new Date(lock.updated_at) >= todayStart
    ).length || 0;
    
    const failedToday = locksByStatus['failed']?.filter((lock: ProcessingLock) => 
      new Date(lock.updated_at) >= todayStart
    ).length || 0;
    
    const failedCount = locksByStatus['failed']?.length || 0;
    const pendingCount = locksByStatus['in_progress']?.length || 0;
    
    // Check for stale locks (in_progress for more than 10 minutes)
    const staleThreshold = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago
    const staleLocks = (locksByStatus['in_progress'] || []).filter((lock: ProcessingLock) => 
      new Date(lock.created_at) < staleThreshold
    );
    const staleLocksCount = staleLocks.length;
    
    // Enhanced stale lock details with staleness duration
    const staleLocksDetails = staleLocks.map((lock: ProcessingLock) => {
      const staleMinutes = Math.floor((now.getTime() - new Date(lock.created_at).getTime()) / (1000 * 60));
      const staleHours = Math.floor(staleMinutes / 60);
      const staleDuration = staleHours > 0 
        ? `${staleHours}h ${staleMinutes % 60}m`
        : `${staleMinutes}m`;
      
      return {
        userId: lock.user_id,
        eventId: lock.event_id || 'unknown',
        createdAt: lock.created_at,
        staleFor: staleDuration,
        staleMinutes: staleMinutes
      };
    }).sort((a: { staleMinutes: number }, b: { staleMinutes: number }) => b.staleMinutes - a.staleMinutes); // Sort by most stale first
    
    // Calculate oldest pending age and latest failure age
    const pendingLocks = locksByStatus['in_progress'] || [];
    const failedLocks = locksByStatus['failed'] || [];
    
    const oldestPendingAge = pendingLocks.length > 0 ?
      Math.floor((Date.now() - new Date(pendingLocks[pendingLocks.length - 1].created_at).getTime()) / 1000) : 0;
    
    const latestFailureAge = failedLocks.length > 0 ?
      Math.floor((Date.now() - new Date(failedLocks[0].updated_at).getTime()) / 1000) : 0;
    
    // Calculate success rate
    const successRate = totalProcessed + totalFailed > 0 
      ? ((totalProcessed / (totalProcessed + totalFailed)) * 100)
      : 100;
    
    // Determine health status
    let healthStatus = 'healthy';
    if (staleLocksCount > 5 || failedToday > 20) {
      healthStatus = 'failing';
    } else if (staleLocksCount > 0 || failedToday > 5 || successRate < 95) {
      healthStatus = 'degraded';
    }
    
    // Get user failure summaries
    const userFailures = Object.entries(
      (locksByStatus['failed'] || []).reduce((acc: Record<string, { userId: string; failureCount: number; latestFailure: string; longestStuckDuration: number }>, lock: ProcessingLock) => {
        const userId = lock.user_id;
        if (!acc[userId]) {
          acc[userId] = {
            userId,
            failureCount: 0,
            latestFailure: lock.updated_at,
            longestStuckDuration: 0
          };
        }
        acc[userId].failureCount++;
        // Calculate stuck duration from created_at to updated_at
        const stuckDuration = Math.floor(
          (new Date(lock.updated_at).getTime() - new Date(lock.created_at).getTime()) / 1000
        );
        if (stuckDuration > acc[userId].longestStuckDuration) {
          acc[userId].longestStuckDuration = stuckDuration;
        }
        return acc;
      }, {})
    ).map(([, data]) => data)
     .sort((a: { failureCount: number }, b: { failureCount: number }) => b.failureCount - a.failureCount)
     .slice(0, 10);
    
    // Get recent failures (last 10)
    const recentFailures = (locksByStatus['failed'] || [])
      .slice(0, 10)
      .map((lock: ProcessingLock) => ({
        userId: lock.user_id,
        eventId: lock.event_id || 'unknown',
        failedAt: lock.updated_at,
        reason: 'Processing failed',
        processingDuration: Math.floor(
          (new Date(lock.updated_at).getTime() - new Date(lock.created_at).getTime()) / 1000
        )
      }));
    
    return NextResponse.json({
      processedToday,
      pendingCount,
      failedCount,
      failedToday,
      successRate: parseFloat(successRate.toFixed(1)),
      healthStatus,
      staleLocksCount,
      staleLocksDetails,
      oldestPendingAge,
      latestFailureAge,
      userFailures,
      recentFailures
    });
    
  } catch (error) {
    console.error('Processing health check failed:', error);
    return NextResponse.json(
      { error: 'Processing health check failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
