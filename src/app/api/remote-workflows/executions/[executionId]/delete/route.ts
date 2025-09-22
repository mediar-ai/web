import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId: executionIdStr } = await params;
    const executionId = parseInt(executionIdStr);

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete the execution
    const { error: deleteError } = await supabase
      .from('workflow_executions')
      .delete()
      .eq('id', executionId);

    if (deleteError) {
      console.error('Error deleting execution:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete execution' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Execution deleted successfully'
    });

  } catch (error) {
    console.error('Error in delete execution endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}