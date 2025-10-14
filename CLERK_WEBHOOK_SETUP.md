# Clerk Webhook → PostHog Integration Setup

## What This Does

Automatically tracks user signups and logins to PostHog when Clerk fires webhook events.

**Events tracked:**
- `user_created` - New user signup
- `session_created` - User login/active session

## Setup Instructions

### 1. Configure Clerk Webhooks

Go to your Clerk Dashboard → Webhooks → Add Endpoint

**Webhook URL:**
```
https://your-domain.com/api/webhooks/clerk
```

**Events to subscribe to:**
- ✅ `user.created`
- ✅ `session.created`
- ✅ `organization.created` (already configured)

### 2. Verify Environment Variables

Ensure these are set in your `.env.local` and Vercel:

```bash
# Clerk
CLERK_WEBHOOK_SECRET=whsec_xxxxx  # From Clerk webhook settings

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

### 3. Deploy to Vercel

```bash
npm run build  # Test locally first
git add .
git commit -m "feat: Add Clerk → PostHog webhook integration"
git push
```

### 4. Test the Webhook

**Option A: Create a test user in Clerk**
1. Go to Clerk Dashboard → Users → Create User
2. Check your logs: `vercel logs --follow`
3. Should see: `[Clerk Webhook] ✓ Tracked user_created in PostHog`

**Option B: Use Clerk's webhook testing**
1. Go to Clerk Dashboard → Webhooks → Your endpoint
2. Click "Send Test Event"
3. Select `user.created` event
4. Check logs for successful PostHog tracking

## Verify in PostHog

1. Go to PostHog dashboard: https://eu.i.posthog.com
2. Navigate to **Events** tab
3. Filter by:
   - Event name: `user_created` (for signups)
   - Event name: `session_created` (for logins)

## Creating Dashboard in PostHog

### New Users (Last 7 Days)
1. Go to **Insights** → **Trends**
2. Select event: `user_created`
3. Date range: **Last 7 days**
4. Save as "New User Signups (7d)"

### Active Users (Last 7 Days)
1. Go to **Insights** → **Trends**
2. Select event: `session_created`
3. Count: **Unique users**
4. Date range: **Last 7 days**
5. Save as "Active Users (7d)"

### Create Combined Dashboard
1. Go to **Dashboards** → **New Dashboard**
2. Name: "User Metrics Monitor"
3. Add both saved insights
4. Set auto-refresh: **Every 30 minutes**

## Troubleshooting

**Webhook not receiving events:**
- Check Clerk webhook logs for delivery failures
- Verify webhook URL is publicly accessible
- Confirm `CLERK_WEBHOOK_SECRET` matches

**PostHog not showing events:**
- Check Vercel logs for PostHog errors
- Verify `NEXT_PUBLIC_POSTHOG_KEY` is correct
- Check PostHog project ID matches

**Events showing but no user data:**
- User identification happens via `distinctId` (Clerk user ID)
- User properties are set in `$set` field
- Check PostHog **Persons** tab to see identified users

## Files Modified

- `src/lib/posthog-server.ts` - Server-side PostHog client
- `src/app/api/webhooks/clerk/route.ts` - Webhook handler with PostHog tracking
- `package.json` - Added `posthog-node` dependency
