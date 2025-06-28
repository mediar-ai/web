import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
  try {
    // Call the sync function we created in the database
    const { error } = await supabase.rpc('sync_all_processed_event_counts');
    
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