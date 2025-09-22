import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all stuck workflows
    const { data: stuck, error } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, created_at, started_at, completed_at')
      .in('status', ['running', 'queued', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error fetching stuck workflows:', error);
      return NextResponse.json(
        { error: 'Failed to fetch workflows' },
        { status: 500 }
      );
    }

    // Count by status
    const statusCounts = {
      running: 0,
      queued: 0,
      cancelled: 0
    };

    stuck?.forEach(w => {
      statusCounts[w.status as keyof typeof statusCounts]++;
    });

    return NextResponse.json({
      total: stuck?.length || 0,
      counts: statusCounts,
      workflows: stuck
    });

  } catch (error) {
    console.error('Error in check stuck endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}