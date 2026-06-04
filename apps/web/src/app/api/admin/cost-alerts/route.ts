import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

// Default thresholds
const DEFAULT_THRESHOLDS = {
  warning: 500,
  critical: 800,
  maximum: 1000,
};

// Settings key in admin_settings table
const SETTINGS_KEY = 'cost_alerts_config';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

export interface CostAlertSettings {
  thresholds: {
    warning: number;
    critical: number;
    maximum: number;
  };
  emailRecipients: string[];
  enabled: boolean;
  lastAlertSent?: {
    level: 'warning' | 'critical' | 'maximum';
    sentAt: string;
    amount: number;
  };
}

/**
 * GET /api/admin/cost-alerts
 * Get current cost alert settings
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Try to get existing settings
  const { data, error } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = not found, which is OK
    console.error('[Cost Alerts] Failed to fetch settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }

  // Return existing settings or defaults
  const settings: CostAlertSettings = data?.value || {
    thresholds: DEFAULT_THRESHOLDS,
    emailRecipients: ['matt@mediar.ai'],
    enabled: true,
  };

  return NextResponse.json({ settings });
}

/**
 * POST /api/admin/cost-alerts
 * Update cost alert settings
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { thresholds, emailRecipients, enabled } = body;

  // Validate thresholds
  if (thresholds) {
    if (thresholds.warning >= thresholds.critical) {
      return NextResponse.json({ error: 'Warning threshold must be less than critical' }, { status: 400 });
    }
    if (thresholds.critical >= thresholds.maximum) {
      return NextResponse.json({ error: 'Critical threshold must be less than maximum' }, { status: 400 });
    }
  }

  // Validate email recipients
  if (emailRecipients) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of emailRecipients) {
      if (!emailRegex.test(email)) {
        return NextResponse.json({ error: `Invalid email: ${email}` }, { status: 400 });
      }
    }
  }

  const supabase = getSupabase();

  // Get existing settings to preserve lastAlertSent
  const { data: existing } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .single();

  const newSettings: CostAlertSettings = {
    thresholds: thresholds || existing?.value?.thresholds || DEFAULT_THRESHOLDS,
    emailRecipients: emailRecipients || existing?.value?.emailRecipients || [],
    enabled: enabled !== undefined ? enabled : existing?.value?.enabled ?? true,
    lastAlertSent: existing?.value?.lastAlertSent,
  };

  // Upsert settings
  const { error } = await supabase
    .from('admin_settings')
    .upsert({
      key: SETTINGS_KEY,
      value: newSettings,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

  if (error) {
    console.error('[Cost Alerts] Failed to save settings:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }

  return NextResponse.json({ settings: newSettings, message: 'Settings saved' });
}

/**
 * DELETE /api/admin/cost-alerts
 * Reset settings to defaults
 */
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  await supabase
    .from('admin_settings')
    .delete()
    .eq('key', SETTINGS_KEY);

  return NextResponse.json({ message: 'Settings reset to defaults' });
}
