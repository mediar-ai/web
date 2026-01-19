import { NextRequest, NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';
import { createServerClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const isAdmin = await isMediarAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const { userId } = await params;

  try {
    const supabase = createServerClient();

    const { data: sessions, error } = await supabase
      .from('workflow_chat_sessions')
      .select('id, title, message_count, messages, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[user-messages] Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessions: sessions || [] });
  } catch (error) {
    console.error('[user-messages] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
