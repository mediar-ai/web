import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Reset all stuck RUNNING workflows to COMPLETED
    const { data: updated, error } = await supabase
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('status', 'running')
      .select();

    if (error) {
      console.error('Error resetting stuck workflows:', error);
      return NextResponse.json(
        { error: 'Failed to reset workflows' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Reset ${updated?.length || 0} stuck workflows`,
      workflows: updated
    });

  } catch (error) {
    console.error('Error in reset stuck endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}