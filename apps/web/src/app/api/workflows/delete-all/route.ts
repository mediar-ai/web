import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    // Delete ALL workflows for this user
    const { error } = await supabaseAdmin
      .from('low_level_workflows')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ 
      success: true, 
      message: `Deleted all workflows for user ${userId}` 
    });

  } catch (error) {
    console.error(`Error deleting all workflows for user ${userId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: errorMessage 
    }, { status: 500 });
  }
} 