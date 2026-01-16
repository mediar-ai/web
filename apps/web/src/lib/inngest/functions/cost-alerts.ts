import { inngest } from '../client';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { CostAlertSettings } from '@/app/api/admin/cost-alerts/route';

const SETTINGS_KEY = 'cost_alerts_config';

const DEFAULT_SETTINGS: CostAlertSettings = {
  thresholds: { warning: 500, critical: 800, maximum: 1000 },
  emailRecipients: ['matt@mediar.ai', 'louis@mediar.ai'],
  enabled: true,
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

async function getAlertSettings(): Promise<CostAlertSettings> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .single();

  return data?.value || DEFAULT_SETTINGS;
}

async function updateLastAlertSent(level: 'warning' | 'critical' | 'maximum', amount: number) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .single();

  const settings = data?.value || DEFAULT_SETTINGS;
  settings.lastAlertSent = {
    level,
    sentAt: new Date().toISOString(),
    amount,
  };

  await supabase
    .from('admin_settings')
    .upsert({ key: SETTINGS_KEY, value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

async function fetchAzureCosts(): Promise<{ total: number; success: boolean }> {
  try {
    // Fetch from our existing Azure billing API
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai';
    const response = await fetch(`${baseUrl}/api/admin/azure-billing`, {
      headers: { 'x-internal-request': 'true' },
    });
    const data = await response.json();

    if (data.success && data.summary) {
      return { total: data.summary.estimatedMonthly || 0, success: true };
    }
    return { total: 0, success: false };
  } catch (err) {
    console.error('[Cost Alerts] Failed to fetch Azure costs:', err);
    return { total: 0, success: false };
  }
}

function getAlertLevel(amount: number, thresholds: CostAlertSettings['thresholds']): 'none' | 'warning' | 'critical' | 'maximum' {
  if (amount >= thresholds.maximum) return 'maximum';
  if (amount >= thresholds.critical) return 'critical';
  if (amount >= thresholds.warning) return 'warning';
  return 'none';
}

function shouldSendAlert(
  currentLevel: 'none' | 'warning' | 'critical' | 'maximum',
  lastAlert: CostAlertSettings['lastAlertSent']
): boolean {
  if (currentLevel === 'none') return false;
  if (!lastAlert) return true;

  // Don't spam - only send if level increased or it's been 24 hours
  const levelPriority = { none: 0, warning: 1, critical: 2, maximum: 3 };
  const currentPriority = levelPriority[currentLevel];
  const lastPriority = levelPriority[lastAlert.level];

  if (currentPriority > lastPriority) return true;

  const hoursSinceLastAlert = (Date.now() - new Date(lastAlert.sentAt).getTime()) / (1000 * 60 * 60);
  return hoursSinceLastAlert >= 24;
}

async function sendAlertEmail(
  level: 'warning' | 'critical' | 'maximum',
  amount: number,
  thresholds: CostAlertSettings['thresholds'],
  recipients: string[]
) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.log('[Cost Alerts] RESEND_API_KEY not configured, skipping email');
    return { sent: false, reason: 'no_resend_key' };
  }

  const resend = new Resend(resendApiKey);
  const fromEmail = (process.env.RESEND_FROM_EMAIL || 'alerts@alerts.mediar.ai').trim();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.mediar.ai';

  const levelConfig = {
    warning: { emoji: '⚠️', color: '#666', urgency: 'approaching threshold' },
    critical: { emoji: '🚨', color: '#333', urgency: 'exceeding budget' },
    maximum: { emoji: '🔴', color: '#000', urgency: 'OVER BUDGET' },
  };

  const config = levelConfig[level];

  const { error } = await resend.emails.send({
    from: `Mediar Alerts <${fromEmail}>`,
    replyTo: ['matt@mediar.ai', 'louis@mediar.ai'],
    to: recipients,
    subject: `${config.emoji} Cloud Cost Alert: ${level.toUpperCase()} - $${amount.toLocaleString()}/month`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1a1a1a; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: ${config.color}; color: white; padding: 24px; text-align: center; }
          .content { background: white; padding: 32px 24px; }
          .alert-box { background: #f5f5f5; border-left: 4px solid ${config.color}; padding: 16px; margin: 16px 0; }
          .threshold-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          .threshold-table td { padding: 8px; border-bottom: 1px solid #e5e5e5; }
          .threshold-table .current { background: #f5f5f5; font-weight: bold; }
          .action-button { display: inline-block; background: #000; color: white !important; padding: 14px 28px; border-radius: 6px; text-decoration: none !important; font-weight: 600; }
          .footer { padding: 24px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e5e5e5; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">${config.emoji} COST ALERT: ${level.toUpperCase()}</h1>
          </div>
          <div class="content">
            <div class="alert-box">
              <strong>Current Monthly Cost:</strong> $${amount.toLocaleString()}<br>
              <strong>Status:</strong> ${config.urgency}
            </div>

            <h3 style="margin-top: 24px;">Threshold Status</h3>
            <table class="threshold-table">
              <tr ${level === 'warning' ? 'class="current"' : ''}>
                <td>Warning</td>
                <td>$${thresholds.warning.toLocaleString()}</td>
                <td>${amount >= thresholds.warning ? '✓ Exceeded' : 'OK'}</td>
              </tr>
              <tr ${level === 'critical' ? 'class="current"' : ''}>
                <td>Critical</td>
                <td>$${thresholds.critical.toLocaleString()}</td>
                <td>${amount >= thresholds.critical ? '✓ Exceeded' : 'OK'}</td>
              </tr>
              <tr ${level === 'maximum' ? 'class="current"' : ''}>
                <td>Maximum</td>
                <td>$${thresholds.maximum.toLocaleString()}</td>
                <td>${amount >= thresholds.maximum ? '✓ EXCEEDED' : 'OK'}</td>
              </tr>
            </table>

            <h3 style="margin-top: 24px;">Recommended Actions</h3>
            <ul style="padding-left: 20px;">
              ${level === 'warning' ? '<li>Review running VMs and stop unused instances</li>' : ''}
              ${level === 'critical' ? '<li>Immediately review all running resources</li><li>Consider stopping non-essential VMs</li>' : ''}
              ${level === 'maximum' ? '<li><strong>URGENT:</strong> Stop non-critical workloads immediately</li><li>Review and delete unused resources</li><li>Contact engineering if needed</li>' : ''}
              <li>Check the billing dashboard for detailed breakdown</li>
            </ul>

            <div style="text-align: center; margin-top: 32px;">
              <a href="${baseUrl}/admin/billing" class="action-button">View Billing Dashboard</a>
            </div>
          </div>
          <div class="footer">
            <p>This is an automated alert from Mediar Cloud Cost Monitoring.</p>
            <p>You can configure alert thresholds in the <a href="${baseUrl}/admin/billing">Admin Billing</a> page.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  });

  if (error) {
    console.error('[Cost Alerts] Failed to send email:', error);
    return { sent: false, reason: error.message };
  }

  console.log(`[Cost Alerts] Sent ${level} alert email to ${recipients.length} recipients`);
  return { sent: true, recipients: recipients.length };
}

/**
 * Cron job to check cloud costs and send alerts
 * Runs every hour
 */
export const costAlertsFunction = inngest.createFunction(
  {
    id: 'check-cost-alerts',
    retries: 1,
  },
  { cron: '0 * * * *' }, // Every hour
  async ({ step }) => {
    // Get settings
    const settings = await step.run('get-settings', async () => {
      return getAlertSettings();
    });

    if (!settings.enabled) {
      return { skipped: true, reason: 'alerts_disabled' };
    }

    if (!settings.emailRecipients || settings.emailRecipients.length === 0) {
      return { skipped: true, reason: 'no_recipients' };
    }

    // Fetch current costs
    const costs = await step.run('fetch-costs', async () => {
      return fetchAzureCosts();
    });

    if (!costs.success) {
      return { error: true, reason: 'failed_to_fetch_costs' };
    }

    // Determine alert level
    const alertLevel = getAlertLevel(costs.total, settings.thresholds);
    console.log(`[Cost Alerts] Current cost: $${costs.total}, Level: ${alertLevel}`);

    // Check if we should send an alert
    if (!shouldSendAlert(alertLevel, settings.lastAlertSent)) {
      return {
        checked: true,
        cost: costs.total,
        level: alertLevel,
        alertSent: false,
        reason: alertLevel === 'none' ? 'within_budget' : 'already_alerted',
      };
    }

    // Send alert email
    const result = await step.run('send-alert', async () => {
      if (alertLevel === 'none') return { sent: false };
      return sendAlertEmail(alertLevel, costs.total, settings.thresholds, settings.emailRecipients);
    });

    // Update last alert sent
    if (result.sent && alertLevel !== 'none') {
      await step.run('update-last-alert', async () => {
        await updateLastAlertSent(alertLevel, costs.total);
      });
    }

    return {
      checked: true,
      cost: costs.total,
      level: alertLevel,
      alertSent: result.sent,
      recipients: settings.emailRecipients.length,
    };
  }
);

/**
 * Manual trigger for testing cost alerts
 */
export const testCostAlertFunction = inngest.createFunction(
  {
    id: 'test-cost-alert',
    retries: 0,
  },
  { event: 'cost-alert/test.requested' },
  async ({ event, step }) => {
    const { email, testLevel } = event.data as { email: string; testLevel?: 'warning' | 'critical' | 'maximum' };

    const settings = await step.run('get-settings', getAlertSettings);
    const level = testLevel || 'warning';
    const testAmount = settings.thresholds[level];

    const result = await step.run('send-test-alert', async () => {
      return sendAlertEmail(level, testAmount, settings.thresholds, [email]);
    });

    return { testSent: result.sent, level, email };
  }
);
