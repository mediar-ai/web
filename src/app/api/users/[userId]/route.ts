import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function PUT(
  request: Request,
  { params }: { params: { userId: string } }
) {
  try {
    const { name } = await request.json();
    const userId = params.userId;

    if (!userId || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // Upsert user
    const { data, error } = await supabase
      .from('mediar_users')
      .upsert({ user_id: userId, name: name }, { onConflict: 'user_id' })
      .select();

    if (error) {
      console.error(`[api/users] Error updating user ${userId}:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[api/users] Failed to update user:', err);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
} 