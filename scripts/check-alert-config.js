// Script to check if alert configurations are properly set up

async function checkAlertConfig() {
  const baseUrl = process.env.VERCEL_URL || 'https://app.mediar.ai';

  console.log('Checking alert configuration...\n');

  try {
    // Check notification configs
    const configResponse = await fetch(`${baseUrl}/api/internal/notifications/configs`);
    if (configResponse.ok) {
      const configs = await configResponse.json();
      console.log(`Found ${configs.length} notification configurations:`);

      configs.forEach(config => {
        console.log(`\n📧 Config: ${config.name}`);
        console.log(`   - Enabled: ${config.enabled}`);
        console.log(`   - Email Enabled: ${config.email_enabled}`);
        console.log(`   - Condition: ${config.condition_type}`);
        console.log(`   - Recipients: ${config.email_recipients?.join(', ') || 'None'}`);
        console.log(`   - Cooldown: ${config.cooldown_minutes} minutes`);
        console.log(`   - Max alerts/hour: ${config.max_alerts_per_hour}`);
      });

      const activeConfigs = configs.filter(c => c.enabled && c.email_enabled);
      if (activeConfigs.length === 0) {
        console.log('\n⚠️  WARNING: No active email alert configurations found!');
        console.log('   You need to create an alert configuration to receive failure notifications.');
        console.log('   Go to: /internal/notifications to set up alerts');
      } else {
        console.log(`\n✅ ${activeConfigs.length} active alert configuration(s) found`);
      }
    } else {
      console.log('❌ Could not fetch notification configs');
    }

    // Check recent alerts
    const alertsResponse = await fetch(`${baseUrl}/api/internal/notifications/alerts?limit=10`);
    if (alertsResponse.ok) {
      const alerts = await alertsResponse.json();
      console.log(`\n📬 Recent alerts: ${alerts.length} found`);

      alerts.slice(0, 5).forEach(alert => {
        console.log(`\n   Alert: ${alert.title}`);
        console.log(`   - Severity: ${alert.severity}`);
        console.log(`   - Created: ${new Date(alert.created_at).toLocaleString()}`);
        console.log(`   - Email sent: ${alert.email_sent ? 'Yes' : 'No'}`);
      });
    }

    // Check email configuration
    const emailResponse = await fetch(`${baseUrl}/api/internal/send-notification-email`);
    if (emailResponse.ok) {
      const emailConfig = await emailResponse.json();
      console.log('\n📧 Email Configuration:');
      console.log(`   - Resend configured: ${emailConfig.resendConfigured}`);
      console.log(`   - From email: ${emailConfig.fromEmail}`);
      console.log(`   - Queued emails: ${emailConfig.emails?.length || 0}`);

      if (!emailConfig.resendConfigured) {
        console.log('\n⚠️  WARNING: Resend API key not configured!');
        console.log('   Set RESEND_API_KEY environment variable to enable email sending');
      }
    }

  } catch (error) {
    console.error('Error checking alert configuration:', error);
  }
}

// Run the check
checkAlertConfig();