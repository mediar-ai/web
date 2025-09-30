import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET() {
  const { data, error } = await supabase
    .from('remote_machines')
    .select('id, name, health_status, uptime_seconds, last_health_check, updated_at')
    .in('id', [6, 11]) // The healthy machines
    .order('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    machines: data,
    note: 'Showing uptime_seconds and last_health_check from DB'
  });
}
