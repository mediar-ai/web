import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(request: NextRequest) {
  try {
    const { action, userId, eventIds } = await request.json();
    const client = await pool.connect();
    
    try {
      let result;
      
      switch (action) {
        case 'clearStaleProcessing':
          // Mark stale locks as failed (same logic as in sequential processor)
          result = await client.query(`
            UPDATE processing_locks 
            SET status = 'failed', updated_at = NOW() 
            WHERE status = 'in_progress' 
              AND created_at < NOW() - INTERVAL '10 minutes'
            RETURNING user_id, event_id;
          `);
          break;
          
        case 'retryFailedUser':
          if (!userId) {
            return NextResponse.json({ error: 'User ID required' }, { status: 400 });
          }
          // Delete failed locks for user to allow retry
          result = await client.query(`
            DELETE FROM processing_locks 
            WHERE user_id = $1 AND status = 'failed'
            RETURNING user_id, event_id;
          `, [userId]);
          break;
          
        case 'skipFailedEvents':
          if (!eventIds || !Array.isArray(eventIds)) {
            return NextResponse.json({ error: 'Event IDs array required' }, { status: 400 });
          }
          // Mark specific events as completed to skip them
          result = await client.query(`
            UPDATE processing_locks 
            SET status = 'completed', updated_at = NOW() 
            WHERE event_id = ANY($1) AND status = 'failed'
            RETURNING user_id, event_id;
          `, [eventIds]);
          break;
          
        case 'forceRetryEvent':
          if (!eventIds || !Array.isArray(eventIds)) {
            return NextResponse.json({ error: 'Event IDs array required' }, { status: 400 });
          }
          // Delete specific failed locks to allow retry
          result = await client.query(`
            DELETE FROM processing_locks 
            WHERE event_id = ANY($1) AND status = 'failed'
            RETURNING user_id, event_id;
          `, [eventIds]);
          break;
          
        default:
          return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }
      
      return NextResponse.json({
        success: true,
        action,
        affectedRows: result.rows.length,
        affectedItems: result.rows,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Processing action failed:', error);
    return NextResponse.json(
      { error: 'Processing action failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
