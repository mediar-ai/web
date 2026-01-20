import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { sessionId } = await params;

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('user_activity_data')
    .select('*')
    .eq('session_id', sessionId)
    .order('client_timestamp', { ascending: false });

  if (error) {
    console.error('Error fetching web session data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
