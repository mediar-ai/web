import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export async function GET() {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({
        error: 'Supabase not configured',
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseServiceKey
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Test 1: Direct table query
    const { data: directTable, error: directError } = await supabase
      .from('remote_machines')
      .select('*');

    // Test 2: With status filter
    const { data: withActive, error: activeError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('status', 'active');

    // Test 3: With NULL status included
    const { data: withNull, error: nullError } = await supabase
      .from('remote_machines')
      .select('*')
      .or('status.eq.active,status.is.null');

    // Test 4: Check what status values exist
    const { data: statusValues, error: statusError } = await supabase
      .from('remote_machines')
      .select('status')
      .limit(20);

    return NextResponse.json({
      success: true,
      tests: {
        direct_query: {
          count: directTable?.length || 0,
          error: directError?.message,
          sample: directTable?.slice(0, 2).map(m => ({
            name: m.name,
            status: m.status,
            id: m.id
          }))
        },
        with_active_filter: {
          count: withActive?.length || 0,
          error: activeError?.message
        },
        with_null_included: {
          count: withNull?.length || 0,
          error: nullError?.message
        },
        status_values: {
          unique_values: [...new Set(statusValues?.map(s => s.status))],
          error: statusError?.message
        }
      }
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}