import { supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Call the sync function we created in the database
    const { error } = await supabase.rpc('sync_session_metadata');
    
    if (error) {
      console.error('Error syncing processed event counts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Processed event counts synced successfully' });
  } catch (error) {
    console.error('Error in sync-processed-counts API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 