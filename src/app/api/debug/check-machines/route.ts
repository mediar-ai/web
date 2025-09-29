import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase environment variables are not set');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    // Check remote_machines table directly
    const { data: machines, error: machinesError } = await supabase
      .from('remote_machines')
      .select('*');

    if (machinesError) {
      console.error('Error fetching from remote_machines:', machinesError);
    }

    // Check available_machines_with_load view
    const { data: machinesWithLoad, error: viewError } = await supabase
      .from('available_machines_with_load')
      .select('*');

    if (viewError) {
      console.error('Error fetching from available_machines_with_load:', viewError);
    }

    // We can't easily check if view exists, so just note if the view query worked
    const viewExists = !viewError;

    return NextResponse.json({
      success: true,
      debug: {
        remote_machines_table: {
          count: machines?.length || 0,
          data: machines || [],
          error: machinesError?.message
        },
        available_machines_with_load_view: {
          count: machinesWithLoad?.length || 0,
          data: machinesWithLoad || [],
          error: viewError?.message
        },
        view_exists: viewExists,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Debug check error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}