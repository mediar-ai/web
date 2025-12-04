import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('mediar_users')
      .select('name')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116: no rows found
      console.error(`[api/users] Error fetching user ${userId}:`, error);
      throw error;
    }
    
    return NextResponse.json(data || {});

  } catch (err) {
    console.error('[api/users] Failed to fetch user:', err);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { name } = await request.json();
    const { userId } = await params;

    if (!userId || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    console.log(`[API/DELETE] Received request to delete user: ${userId}`);

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // [PROTECTION] PROTECTION: Check for active processing before deletion
    console.log(`[API/DELETE] Checking for active processing for user: ${userId}`);
    const { data: activeLocks, error: lockError } = await supabaseAdmin
      .from('processing_locks')
      .select('event_id, processor_id, created_at')
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .gt('expires_at', new Date().toISOString());

    if (lockError) {
      console.error(`[API/DELETE] Error checking processing locks for user ${userId}:`, lockError);
      return NextResponse.json({ 
        error: 'Failed to check processing status', 
        details: lockError.message 
      }, { status: 500 });
    }

    if (activeLocks && activeLocks.length > 0) {
      console.log(`[API/DELETE] BLOCKED: Found ${activeLocks.length} active processing locks for user ${userId}`);
      return NextResponse.json({ 
        error: 'Cannot delete user data while processing is active',
        details: `${activeLocks.length} events are currently being processed. Please wait and try again.`,
        activeLocks: activeLocks.map(lock => ({
          event_id: lock.event_id,
          processor_id: lock.processor_id,
          started_at: lock.created_at
        }))
      }, { status: 409 }); // 409 Conflict
    }
    
    // Step 1: Delete all files in Supabase Storage for this user
    console.log(`[API/DELETE] Deleting storage folder for user: ${userId}`);
    const { data: list, error: listError } = await supabaseAdmin.storage
      .from('low-level-event-screenshots')
      .list(userId);

    if (listError) {
      console.error(`[API/DELETE] Error listing files for user ${userId}:`, listError);
      // Don't throw, maybe the folder doesn't exist which is fine.
    }

    if (list && list.length > 0) {
      const filesToDelete = list.map((file) => `${userId}/${file.name}`);
      // Supabase storage doesn't have a direct folder delete, so we remove all files.
      // A more complex implementation could handle subfolders if they exist.
      // For now, assuming a flat structure under the userId folder.
      const { error: removalError } = await supabaseAdmin.storage
        .from('low-level-event-screenshots')
        .remove(filesToDelete);
        
      if (removalError) {
        console.error(`[API/DELETE] Error deleting storage files for user ${userId}:`, removalError);
        throw new Error(`Failed to delete storage files: ${removalError.message}`);
      }
    }
    
    // Step 3: Delete all records from related tables using the admin client
    // The order matters to respect foreign key constraints if they exist.
    console.log(`[API/DELETE] Deleting database records for user: ${userId}`);

    // [CLEAN] Clean up any expired/completed processing locks first
    await supabaseAdmin
      .from('processing_locks')
      .delete()
      .eq('user_id', userId)
      .in('status', ['completed', 'failed']);

    await supabaseAdmin.from('user_activity_data').delete().eq('user_id', userId);
    await supabaseAdmin.from('low_level_workflow_analyses').delete().eq('user_id', userId);
    await supabaseAdmin.from('low_level_events').delete().eq('user_id', userId);
    await supabaseAdmin.from('session_metadata').delete().eq('user_id', userId);
    // We are intentionally NOT deleting from 'mediar_users' to preserve the user's name.

    console.log(`[API/DELETE] Successfully deleted all data for user: ${userId}`);
    return NextResponse.json({ message: `User ${userId} and all associated data deleted successfully.` });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
    console.error('[API/DELETE] Failed to delete user:', errorMessage);
    return NextResponse.json({ error: 'Failed to delete user data', details: errorMessage }, { status: 500 });
  }
} 