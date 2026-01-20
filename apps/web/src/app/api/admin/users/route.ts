import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// Update user name
export async function PUT(request: Request) {
  const supabase = getSupabaseAdmin();
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId, name } = await request.json();

    if (!userId || !name?.trim()) {
      return NextResponse.json({ error: 'User ID and name are required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('mediar_users')
      .upsert({ user_id: userId, name: name.trim() }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error updating user name:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in PUT /api/admin/users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Delete user and their data
export async function DELETE(request: Request) {
  const supabase = getSupabaseAdmin();
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Delete from mediar_users table
    const { error: mediarUsersError } = await supabase
      .from('mediar_users')
      .delete()
      .eq('user_id', userId);

    if (mediarUsersError) {
      console.error('Error deleting from mediar_users:', mediarUsersError);
      return NextResponse.json({ error: mediarUsersError.message }, { status: 500 });
    }

    // Delete from session_metadata table
    const { error: sessionError } = await supabase
      .from('session_metadata')
      .delete()
      .eq('user_id', userId);

    if (sessionError) {
      console.error('Error deleting from session_metadata:', sessionError);
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
