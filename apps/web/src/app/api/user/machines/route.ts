import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/user/machines
 * Get all machines accessible to the current user (own + org's + global)
 */
export async function GET() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get machines: user's own + org's + global (but filter out global for this page - those are shared infra)
  const { data: machines, error } = await supabase
    .from('remote_machines')
    .select('id, name, status, health_status, region, machine_type, provisioning_step, created_at, provisioned_at, owner_user_id, owner_org_id')
    .or(`owner_user_id.eq.${userId}${orgId ? `,owner_org_id.eq.${orgId}` : ''}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[User Machines API] Failed to fetch machines:', error);
    return NextResponse.json({ error: 'Failed to fetch machines' }, { status: 500 });
  }

  return NextResponse.json({
    machines: machines || [],
  });
}
