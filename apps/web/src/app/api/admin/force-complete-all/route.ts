import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMediarAdmin } from '@/lib/auth/requireMediarAdmin';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_request: NextRequest) {
  try {
    const denied = await requireMediarAdmin();
    if (denied) return denied;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Force complete ALL workflows regardless of status
    const { data: completed, error } = await supabase
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .in('status', ['running', 'queued', 'cancelled'])
      .select();

    if (error) {
      console.error('Error force completing workflows:', error);
      return NextResponse.json(
        { error: 'Failed to complete workflows' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Force completed ${completed?.length || 0} workflows`,
      workflows: completed
    });

  } catch (error) {
    console.error('Error in force complete endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}