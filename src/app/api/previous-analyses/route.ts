import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from('user_activity_data')
      .select('id, item_data, client_timestamp')
      .eq('user_id', userId)
      .eq('item_type', 'workflow_step')
      .order('client_timestamp', { ascending: false })
      .limit(3);

    if (error) {
      throw error;
    }

    const analyses = data.map(item => ({
      id: item.id,
      workflow: item.item_data.workflow,
      step: item.item_data.step,
      description: item.item_data.description,
      created_at: item.client_timestamp,
    }));

    return NextResponse.json({ analyses });
  } catch (error) {
    console.error('Error fetching workflow analyses:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 