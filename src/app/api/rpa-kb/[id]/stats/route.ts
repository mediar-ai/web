/**
 * RPA Knowledgebase Stats Update API
 * POST: Update execution statistics for a step
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/rpa-kb/[id]/stats
 * Update execution statistics for a step
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const {
      success, // boolean: did execution succeed?
      duration_ms, // number: execution duration in milliseconds
    } = body;

    // Validate inputs
    if (success === undefined) {
      return NextResponse.json(
        { error: 'success field is required (boolean)' },
        { status: 400 }
      );
    }

    console.log('📊 Updating stats for step:', id, { success, duration_ms });

    // Call atomic update function
    const { error } = await supabase.rpc('increment_rpa_kb_stats', {
      step_id: id,
      is_success: success,
      execution_duration: duration_ms || null,
    });

    if (error) {
      console.error('❌ Stats update error:', error);
      return NextResponse.json(
        { error: 'Failed to update stats', details: error.message },
        { status: 500 }
      );
    }

    // Fetch updated step to return new stats
    const { data: updatedStep, error: fetchError } = await supabase
      .from('rpa_knowledgebase')
      .select('succeeded, failed, duration_ms, ranking, last_executed_at')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('⚠️ Failed to fetch updated stats:', fetchError);
      // Still return success since update worked
      return NextResponse.json({
        success: true,
        message: 'Stats updated successfully',
      });
    }

    console.log('✅ Stats updated:', updatedStep);

    return NextResponse.json({
      success: true,
      data: updatedStep,
      message: 'Stats updated successfully',
    });
  } catch (error: any) {
    console.error('❌ Failed to update stats:', error);
    return NextResponse.json(
      {
        error: 'Failed to update stats',
        details: error.message || String(error),
      },
      { status: 500 }
    );
  }
}

