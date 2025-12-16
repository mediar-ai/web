import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RETENTION_DAYS = 90;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * GET /api/cron/llm-traces-cleanup
 *
 * Deletes mediar_llm_traces records older than 90 days.
 * Runs daily via Vercel cron.
 */
export async function GET(request: Request) {
  const startTime = Date.now();

  // Check if request is from Vercel Cron (has vercel-cron user agent)
  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');

  // If NOT from Vercel Cron, verify auth
  if (!isVercelCron) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn('[LLM Traces Cleanup] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('[LLM Traces Cleanup] Starting cleanup job');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[LLM Traces Cleanup] Supabase not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate cutoff date (90 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoffDate.toISOString();

    console.log(`[LLM Traces Cleanup] Deleting records older than ${cutoffIso}`);

    // Get count before deletion for logging
    const { count: beforeCount } = await supabase
      .from('mediar_llm_traces')
      .select('*', { count: 'exact', head: true })
      .lt('created_at', cutoffIso);

    if (beforeCount === 0) {
      console.log('[LLM Traces Cleanup] No records to delete');
      return NextResponse.json({
        success: true,
        deletedCount: 0,
        message: 'No records older than 90 days',
        durationMs: Date.now() - startTime,
      });
    }

    console.log(`[LLM Traces Cleanup] Found ${beforeCount} records to delete`);

    // Delete old records in batches to avoid timeout
    let totalDeleted = 0;
    const BATCH_SIZE = 1000;

    while (true) {
      // Get IDs of records to delete
      const { data: oldRecords, error: selectError } = await supabase
        .from('mediar_llm_traces')
        .select('id')
        .lt('created_at', cutoffIso)
        .limit(BATCH_SIZE);

      if (selectError) {
        console.error('[LLM Traces Cleanup] Error selecting records:', selectError);
        break;
      }

      if (!oldRecords || oldRecords.length === 0) {
        break;
      }

      const ids = oldRecords.map((r: { id: string }) => r.id);

      const { error: deleteError } = await supabase
        .from('mediar_llm_traces')
        .delete()
        .in('id', ids);

      if (deleteError) {
        console.error('[LLM Traces Cleanup] Error deleting batch:', deleteError);
        break;
      }

      totalDeleted += ids.length;
      console.log(`[LLM Traces Cleanup] Deleted batch of ${ids.length}, total: ${totalDeleted}`);

      // Safety check - don't run too long
      if (Date.now() - startTime > 50000) {
        console.log('[LLM Traces Cleanup] Approaching timeout, stopping');
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[LLM Traces Cleanup] Completed: deleted ${totalDeleted} records in ${durationMs}ms`);

    return NextResponse.json({
      success: true,
      deletedCount: totalDeleted,
      retentionDays: RETENTION_DAYS,
      cutoffDate: cutoffIso,
      durationMs,
    });
  } catch (error) {
    console.error('[LLM Traces Cleanup] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
