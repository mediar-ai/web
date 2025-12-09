import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { WorkflowFileManager } from '@/lib/workflow-file-manager';

export async function POST(request: NextRequest) {
  try {
    // Verify internal API key or auth
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cleanupType = 'all' } = await request.json();
    const fileManager = new WorkflowFileManager();

    const results = {
      storage: { deleted: 0, error: null as string | null },
      cache: { cleaned: 0, error: null as string | null }
    };

    // Cleanup storage files
    if (cleanupType === 'storage' || cleanupType === 'all') {
      try {
        const deletedCount = await fileManager.cleanupOldFiles(90); // 90 days retention
        results.storage.deleted = deletedCount;
      } catch (error) {
        results.storage.error = error instanceof Error ? error.message : 'Storage cleanup failed';
      }
    }

    // Cleanup cache on machines
    if (cleanupType === 'cache' || cleanupType === 'all') {
      try {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Get all machines
        const { data: machines } = await supabase
          .from('remote_machines')
          .select('id, name')
          .eq('status', 'active');

        if (machines) {
          for (const machine of machines) {
            // Trigger cleanup on each machine via function call
            const { data, error } = await supabase.rpc('cleanup_old_cache', {
              p_machine_id: machine.id,
              p_max_age_days: 7
            });

            if (!error && data) {
              results.cache.cleaned += data.deleted_count || 0;
            }
          }
        }
      } catch (error) {
        results.cache.error = error instanceof Error ? error.message : 'Cache cleanup failed';
      }
    }

    // Update cleanup policy last run time
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase
      .from('file_cleanup_policy')
      .update({ last_run_at: new Date().toISOString() })
      .eq('policy_name', `${cleanupType}_cleanup`);

    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint for manual trigger or monitoring
export async function GET(_request: NextRequest) {
  try {
    // Return cleanup statistics
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: cacheStats } = await supabase
      .from('machine_cache_stats')
      .select('*');

    const { data: fileStats } = await supabase
      .from('workflow_files')
      .select('count')
      .single();

    const { data: policies } = await supabase
      .from('file_cleanup_policy')
      .select('*');

    return NextResponse.json({
      cache: cacheStats,
      files: fileStats,
      policies
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to get statistics' },
      { status: 500 }
    );
  }
}