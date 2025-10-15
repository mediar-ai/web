import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/lib/notification-service';
import { supabase } from '@/lib/supabase';

const notificationService = NotificationService.getInstance();

/**
 * Process Pending Notifications Cron Job
 * Called every minute by Vercel Cron to send queued notification emails
 */
export async function POST(_request: NextRequest) {
  const startTime = Date.now();
  const currentTime = new Date();

  console.log(`📧 [${currentTime.toISOString()}] Processing pending notification emails`);

  try {
    // Get all pending alerts that are scheduled to be sent now or earlier
    const { data: pendingAlerts, error: fetchError } = await supabase
      .from('notification_alerts')
      .select('*')
      .eq('email_sent', false)
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', currentTime.toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(50); // Process up to 50 at a time to avoid timeouts

    if (fetchError) {
      console.error('❌ Error fetching pending alerts:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch pending alerts' },
        { status: 500 }
      );
    }

    if (!pendingAlerts || pendingAlerts.length === 0) {
      console.log('📭 No pending notification emails to send');
      return NextResponse.json({
        success: true,
        message: 'No pending notifications',
        emailsSent: 0,
        emailsRescheduled: 0,
        processingTimeMs: Date.now() - startTime,
      });
    }

    console.log(`📋 Found ${pendingAlerts.length} pending notification emails`);

    let emailsSent = 0;
    let emailsRescheduled = 0;
    let emailsFailed = 0;

    // Process each pending alert
    for (const alert of pendingAlerts) {
      try {
        // Get the config for this alert
        const config = await notificationService.getConfig(alert.config_id);

        if (!config) {
          console.error(`❌ Config ${alert.config_id} not found for alert ${alert.id}`);
          emailsFailed++;
          continue;
        }

        // Skip if config is no longer enabled
        if (!config.enabled || !config.email_enabled) {
          console.log(`⏭️ Config ${alert.config_id} disabled, clearing scheduled_for for alert ${alert.id}`);
          await supabase
            .from('notification_alerts')
            .update({ scheduled_for: null })
            .eq('id', alert.id);
          continue;
        }

        // Re-check rate limits (in case multiple alerts are scheduled)
        // This is a private method, so we need to use a workaround
        // For now, we'll just try to send and let it handle rate limits

        // Get workflow's organization for fetching members
        let targetOrgId = config.organization_id;
        if (!targetOrgId && alert.workflow_id) {
          const { data: workflow } = await supabase
            .from('deployed_workflows')
            .select('organization_id')
            .eq('id', alert.workflow_id)
            .single();
          targetOrgId = workflow?.organization_id;
        }

        // Fetch recipients
        let recipients = config.email_recipients || [];

        if (targetOrgId) {
          try {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
              (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://app.mediar.ai');

            const orgMembersResponse = await fetch(`${baseUrl}/api/organization-members?orgId=${targetOrgId}`);
            if (orgMembersResponse.ok) {
              const orgMembersData = await orgMembersResponse.json();
              const orgEmails = orgMembersData.members?.map((m: any) => m.email).filter(Boolean) || [];
              recipients = [...new Set([...recipients, ...orgEmails])];
            }
          } catch (err) {
            console.error(`Error fetching organization members for alert ${alert.id}:`, err);
          }
        }

        if (recipients.length === 0) {
          console.warn(`⚠️ No recipients for alert ${alert.id}, clearing scheduled_for`);
          await supabase
            .from('notification_alerts')
            .update({ scheduled_for: null })
            .eq('id', alert.id);
          continue;
        }

        // Send email
        console.log(`📤 Sending email for alert ${alert.id} to ${recipients.length} recipients`);

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://app.mediar.ai');

        const emailResponse = await fetch(`${baseUrl}/api/internal/send-notification-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipients,
            subject: `[${alert.severity?.toUpperCase() || 'ALERT'}] ${alert.title}`,
            alert,
            config,
          }),
        });

        if (emailResponse.ok) {
          // Mark as sent
          await supabase
            .from('notification_alerts')
            .update({
              email_sent: true,
              email_sent_at: new Date().toISOString(),
              scheduled_for: null,
            })
            .eq('id', alert.id);

          console.log(`✅ Email sent successfully for alert ${alert.id}`);
          emailsSent++;
        } else {
          const errorText = await emailResponse.text();
          console.error(`❌ Failed to send email for alert ${alert.id}: ${emailResponse.status} - ${errorText}`);

          // If rate limited again, reschedule for 2 minutes from now
          if (errorText.includes('rate limit') || errorText.includes('cooldown')) {
            const newScheduledFor = new Date(Date.now() + (2 * 60 * 1000));
            await supabase
              .from('notification_alerts')
              .update({ scheduled_for: newScheduledFor.toISOString() })
              .eq('id', alert.id);
            console.log(`⏰ Rescheduled alert ${alert.id} for ${newScheduledFor.toISOString()}`);
            emailsRescheduled++;
          } else {
            emailsFailed++;
          }
        }
      } catch (error) {
        console.error(`❌ Error processing alert ${alert.id}:`, error);
        emailsFailed++;
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`🏁 Pending notifications processed in ${processingTime}ms`);
    console.log(`📊 Results: ${emailsSent} sent, ${emailsRescheduled} rescheduled, ${emailsFailed} failed`);

    return NextResponse.json({
      success: true,
      timestamp: currentTime.toISOString(),
      processingTimeMs: processingTime,
      totalPending: pendingAlerts.length,
      emailsSent,
      emailsRescheduled,
      emailsFailed,
    });
  } catch (error) {
    console.error('❌ Process pending notifications error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: currentTime.toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Vercel cron uses GET, so we handle both GET and POST the same way
 */
export async function GET(request: NextRequest) {
  return POST(request);
}
