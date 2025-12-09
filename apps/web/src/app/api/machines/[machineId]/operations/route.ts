import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  // Check authentication
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    const { machineId: id } = await params;
    const machineId = parseInt(id);

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status');
    const operationType = searchParams.get('type');

    // Build query
    let query = supabase
      .from('machine_operations')
      .select('*')
      .eq('machine_id', machineId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    if (operationType) {
      query = query.eq('operation_type', operationType);
    }

    const { data: operations, error } = await query;

    if (error) {
      console.error('[Machine Operations] Query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch operations' },
        { status: 500 }
      );
    }

    // Get machine info for context
    const { data: machine } = await supabase
      .from('remote_machines')
      .select('name, power_state, power_state_updated_at')
      .eq('id', machineId)
      .single();

    return NextResponse.json({
      success: true,
      machine: {
        id: machineId,
        name: machine?.name,
        powerState: machine?.power_state,
        powerStateUpdatedAt: machine?.power_state_updated_at,
      },
      operations: operations || [],
      count: operations?.length || 0,
    });
  } catch (error: unknown) {
    console.error('[Machine Operations] Error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to fetch operations';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
