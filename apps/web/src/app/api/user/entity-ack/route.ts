import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

// Cutoff: users created before this date need to acknowledge
const ENTITY_CHANGE_CUTOFF = '2026-03-13T00:00:00Z';

/**
 * GET: Check if current user needs to acknowledge entity name change.
 * Returns { needsAck: boolean }
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ needsAck: false });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: user, error } = await supabase
      .from('mediar_users')
      .select('entity_name_ack_at, created_at')
      .eq('user_id', userId)
      .single();

    if (error || !user) {
      // User not in mediar_users yet = new user, no ack needed
      return NextResponse.json({ needsAck: false });
    }

    // Only existing users (created before cutoff) who haven't acked
    const isExistingUser = new Date(user.created_at) < new Date(ENTITY_CHANGE_CUTOFF);
    const needsAck = isExistingUser && !user.entity_name_ack_at;

    console.log('[entity-ack] GET', { userId, isExistingUser, needsAck });
    return NextResponse.json({ needsAck });
  } catch (err) {
    console.error('[entity-ack] GET error:', err);
    return NextResponse.json({ needsAck: false });
  }
}

/**
 * POST: Record user's acknowledgment of entity name change.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('mediar_users')
      .update({ entity_name_ack_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('[entity-ack] POST error:', error);
      return NextResponse.json({ error: 'Failed to record acknowledgment' }, { status: 500 });
    }

    console.log('[entity-ack] POST recorded for', userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[entity-ack] POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
