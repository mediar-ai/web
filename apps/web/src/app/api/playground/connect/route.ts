/**
 * Playground Connect API
 *
 * Generates authenticated Guacamole connection URLs for the playground.
 * Mediar-admin only for now.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { getDirectConnectionUrl } from '@/lib/guacamole-client';

const GUACAMOLE_URL = process.env.GUACAMOLE_URL?.trim() || '';
const GUACAMOLE_USERNAME = process.env.GUACAMOLE_USERNAME?.trim() || '';
const GUACAMOLE_PASSWORD = process.env.GUACAMOLE_PASSWORD?.trim() || '';

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Mediar admin check
    const user = await currentUser();
    const isMediarAdmin = user?.emailAddresses?.some(e =>
      e.emailAddress.toLowerCase().endsWith('@mediar.ai')
    );

    if (!isMediarAdmin) {
      return NextResponse.json({ error: 'Forbidden - Mediar admin only' }, { status: 403 });
    }

    // Parse body
    const body = await request.json();
    const { machineId } = body;

    if (!machineId) {
      return NextResponse.json({ error: 'machineId is required' }, { status: 400 });
    }

    // Get machine from Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: machine, error: machineError } = await supabase
      .from('remote_machines')
      .select('id, name, guacamole_connection_name, status, health_status')
      .eq('id', machineId)
      .single();

    if (machineError || !machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
    }

    if (!machine.guacamole_connection_name) {
      return NextResponse.json({
        error: 'Machine not configured for remote access',
        details: 'No Guacamole connection name configured',
      }, { status: 500 });
    }

    // Generate Guacamole URL
    const result = await getDirectConnectionUrl(
      GUACAMOLE_URL,
      GUACAMOLE_USERNAME,
      GUACAMOLE_PASSWORD,
      machine.guacamole_connection_name
    );

    console.log(`[Playground] User ${userId} connected to machine ${machine.name}`);

    return NextResponse.json({
      url: result.url,
      connectionName: result.connectionName,
      machineName: machine.name,
    });

  } catch (error) {
    console.error('[Playground Connect] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
