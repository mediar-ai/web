# Email Notification Setup Guide

## Quick Setup with Resend

### Step 1: Create a Resend Account
1. Go to https://resend.com/signup
2. Sign up for a free account (includes 100 emails/day free)

### Step 2: Get Your API Key
1. After signing in, go to https://resend.com/api-keys
2. Click "Create API Key"
3. Name it (e.g., "Deployment Alerts")
4. Copy the API key (starts with `re_`)

### Step 3: Verify Your Domain (Optional but Recommended)
1. Go to https://resend.com/domains
2. Add your domain (e.g., mediar.ai)
3. Follow the DNS verification steps
4. Once verified, you can send from any email@yourdomain.com

**For testing:** You can use `onboarding@resend.dev` without domain verification

### Step 4: Configure Environment Variables
Add these to your `.env.local` file:

```env
# Resend Email Configuration
RESEND_API_KEY="re_YOUR_API_KEY_HERE"
RESEND_FROM_EMAIL="alerts@yourdomain.com"  # Or use "onboarding@resend.dev" for testing
```

### Step 5: Restart Your Dev Server
```bash
# Stop the current server (Ctrl+C)
npm run dev
```

## Testing Your Setup

### 1. Check Email Configuration Status
Visit: http://localhost:3003/api/internal/send-notification-email

You should see:
```json
{
  "emails": [],
  "resendConfigured": true,
  "fromEmail": "alerts@yourdomain.com"
}
```

### 2. Create a Test Alert Rule
1. Go to http://localhost:3003/internal/notifications
2. Click "Add Rule"
3. Configure:
   - **Name:** Test Error Alerts
   - **Condition:** Execution Error
   - **Enable Email:** Toggle ON
   - **Add Recipients:** Your email address
   - **Cooldown:** 5 minutes (prevents spam)
   - **Max Alerts/Hour:** 10

### 3. Trigger a Test Alert
The system will automatically send alerts when:
- A workflow execution fails
- Execution time exceeds threshold
- Multiple failures occur in quick succession

## Alternative Email Services

### SendGrid
```env
SENDGRID_API_KEY="your_api_key"
SENDGRID_FROM_EMAIL="alerts@yourdomain.com"
```

### AWS SES
```env
AWS_ACCESS_KEY_ID="your_access_key"
AWS_SECRET_ACCESS_KEY="your_secret_key"
AWS_REGION="us-east-1"
AWS_SES_FROM_EMAIL="alerts@yourdomain.com"
```

### Mailgun
```env
MAILGUN_API_KEY="your_api_key"
MAILGUN_DOMAIN="mg.yourdomain.com"
MAILGUN_FROM_EMAIL="alerts@mg.yourdomain.com"
```

## Email Content

Emails include:
- **Alert severity** (Critical, High, Medium, Low)
- **Error details** and stack traces
- **Workflow and execution IDs**
- **Timestamp** of the incident
- **Direct link** to manage notifications

## Troubleshooting

### Emails Not Sending?
1. Check console logs for errors
2. Verify API key is correct
3. Check if you've hit rate limits (100/day on free tier)
4. Ensure sender email is verified (for custom domains)

### View Queued Emails (Development)
Visit: http://localhost:3003/api/internal/send-notification-email

This shows all emails that would have been sent (useful for testing without sending real emails)

### Test Without Real Emails
Remove the `RESEND_API_KEY` from `.env.local` to run in "queue mode" - emails will be logged to console instead of sent.

## Production Considerations

1. **Use environment variables** in your deployment platform (Vercel, etc.)
2. **Verify your domain** for better deliverability
3. **Set appropriate rate limits** to prevent alert fatigue
4. **Configure SPF/DKIM/DMARC** records for your domain
5. **Monitor your email bounce rates** in Resend dashboard

## Support

- Resend Docs: https://resend.com/docs
- Resend Status: https://status.resend.com/
- Our notification config: `/internal/notifications`