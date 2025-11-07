# Notion to Apollo Sync

Automated sync of meeting notes from Notion to Apollo CRM.

## Overview

This cron job runs every 15 minutes to sync newly created/updated meeting notes from your Notion database to Apollo CRM. It uses email as the transport mechanism - Apollo ingests the notes via a special email address and automatically matches them to contacts.

## Architecture

```
┌─────────┐     Every 15 mins      ┌──────────────┐
│ Vercel  │ ──────────────────────▶│  Cron Job    │
│  Cron   │                         │  /api/cron/  │
└─────────┘                         │  sync-notion │
                                    │  -to-apollo  │
                                    └──────┬───────┘
                                           │
                        ┌──────────────────┼──────────────────┐
                        │                  │                  │
                        ▼                  ▼                  ▼
                   ┌─────────┐       ┌─────────┐       ┌─────────┐
                   │ Notion  │       │ Resend  │       │Supabase │
                   │   API   │       │   API   │       │   DB    │
                   └─────────┘       └─────────┘       └─────────┘
                        │                  │                  │
                        │ Meeting notes    │ Email to Apollo  │ Track syncs
                        └──────────────────┴──────────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │   Apollo    │
                                    │     CRM     │
                                    └─────────────┘
```

## Setup

### 1. Notion Configuration

1. **Create a Notion Integration:**
   - Go to https://www.notion.so/my-integrations
   - Click "+ New integration"
   - Name it "Apollo Sync" or similar
   - Copy the "Internal Integration Token" → `NOTION_API_KEY`

2. **Share your database with the integration:**
   - Open your meeting notes database in Notion
   - Click "..." → "Add connections"
   - Select your integration

3. **Get your database ID:**
   - Open the database as a full page
   - Copy ID from URL: `notion.so/workspace/{DATABASE_ID}?v=...`
   - Set as `NOTION_DATABASE_ID`

4. **Database schema requirements:**
   Your Notion database must have these properties:
   - `Name` or `Title` (title) - Meeting name
   - `Email` or `Attendee Email` (email or text) - Contact's email
   - The page content contains the meeting notes

### 2. Apollo Configuration

1. **Get your email ingestion address:**
   - Contact Apollo support or check docs for your workspace's ingestion email
   - Format usually: `workspace-name@ingest.apollo.io`
   - Set as `APOLLO_INGEST_EMAIL`

2. **Test email ingestion:**
   ```bash
   # Send a test email to verify it works
   curl -X POST https://api.resend.com/emails \
     -H "Authorization: Bearer $RESEND_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "from": "meetings@mediar.ai",
       "to": "your-apollo-ingest@apollo.io",
       "cc": "test-contact@example.com",
       "subject": "Test Meeting",
       "text": "This is a test meeting note"
     }'
   ```

### 3. Resend Configuration

1. **Get API key:**
   - Sign up at https://resend.com
   - Go to API Keys → Create API Key
   - Copy the key → `RESEND_API_KEY`

2. **Verify sending domain:**
   - Add and verify `mediar.ai` (or your domain)
   - Set `RESEND_FROM_EMAIL=meetings@mediar.ai`

### 4. Database Migration

Run the migration to create required tables:

```bash
cd supabase
supabase db push migrations/20251107_notion_apollo_sync.sql
```

Or manually execute the SQL in your Supabase dashboard.

### 5. Environment Variables

Add to your `.env` file:

```bash
# Copy from .env.notion-apollo-sync.example
NOTION_API_KEY=secret_...
NOTION_DATABASE_ID=...
APOLLO_INGEST_EMAIL=...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=meetings@mediar.ai
```

### 6. Deploy

```bash
# Push to main to deploy
git add .
git commit -m "Add Notion to Apollo sync cron"
git push origin main

# Vercel will auto-deploy and register the cron job
```

## How It Works

### Cron Schedule

Runs every 15 minutes: `*/15 * * * *`

### Sync Process

1. **Check last sync time** from `notion_apollo_sync_state` table
2. **Query Notion** for pages updated since last sync
3. **For each meeting note:**
   - Extract title, attendee email, content
   - Send email via Resend to Apollo's ingestion address
   - CC the attendee's email (Apollo matches by CC)
   - Track synced page in `notion_apollo_synced_pages`
4. **Update last sync time** in database

### Duplicate Prevention

- Tracks synced pages by `notion_page_id`
- Only syncs new/updated notes since last run
- Uses database upserts to handle edge cases

## Testing

### Manual Trigger

```bash
# Local development
curl -X POST http://localhost:3000/api/cron/sync-notion-to-apollo

# Production
curl -X POST https://app.mediar.ai/api/cron/sync-notion-to-apollo \
  -H "Authorization: Bearer $VERCEL_CRON_SECRET"
```

### Check Logs

```bash
# Vercel dashboard → Functions → Logs
# Or use CLI:
vercel logs --follow
```

### Verify Sync

1. Check Supabase tables:
   ```sql
   SELECT * FROM notion_apollo_synced_pages ORDER BY synced_at DESC LIMIT 10;
   SELECT * FROM notion_apollo_sync_state;
   ```

2. Check Apollo CRM for new notes on contacts

## Troubleshooting

### Missing attendee email

**Error:** `⚠️ Skipping page {id}: no attendee email found`

**Fix:** Ensure your Notion database has an `Email` or `Attendee Email` property with the contact's email.

### Email not sent

**Error:** `Failed to send email: 401`

**Fix:** Check `RESEND_API_KEY` is correct and domain is verified.

### Notes not appearing in Apollo

**Possible causes:**
1. Apollo ingestion email is incorrect
2. Email not CC'd to contact (Apollo matches by CC)
3. Apollo workspace not configured for email ingestion

**Debug:**
- Check Resend dashboard for sent emails
- Forward a test email manually to Apollo ingestion address
- Contact Apollo support to verify ingestion is enabled

### Duplicate syncs

If you see duplicate notes in Apollo:

1. Check `notion_apollo_synced_pages` table for the page
2. If missing, the cron may have failed mid-sync
3. Clear the entry and re-run to fix

## Customization

### Sync Frequency

Edit `vercel.json`:

```json
{
  "path": "/api/cron/sync-notion-to-apollo",
  "schedule": "*/5 * * * *"  // Every 5 minutes
}
```

### Database Property Names

Edit `src/app/api/cron/sync-notion-to-apollo/route.ts`:

```typescript
// Change property names to match your Notion database
const titleProp = page.properties['Meeting Name']; // Your custom title
const emailProp = page.properties['Contact Email']; // Your custom email field
```

### Email Format

Customize the email body in `sendToApollo()` function:

```typescript
const emailBody = `
${meetingNote.content}

Meeting Date: ${new Date(meetingNote.lastEdited).toLocaleString()}
Synced via Mediar
`.trim();
```

## Monitoring

### Success Metrics

Check cron logs for:
- `syncedCount`: Number of notes synced successfully
- `failedCount`: Number of failed syncs
- `processingTimeMs`: How long the cron took

### Alerts

Set up alerts in Vercel/Sentry for:
- Cron failures (500 errors)
- Missing env vars
- Sync taking >30 seconds

## Cost

- **Notion API:** Free (1000 requests/hr limit)
- **Resend:** Free tier (100 emails/day, then $0.001/email)
- **Vercel Cron:** Free (up to 100 cron jobs)
- **Supabase:** Free tier (500MB database)

For 20 meetings/day:
- ~20 Notion API calls/day
- ~20 emails/day
- Total cost: **$0/month** (within free tiers)

## Security

- Uses service role key for Supabase (cron auth)
- Notion API key stored as env var
- Resend API key stored as env var
- Email transport uses TLS
- No sensitive data logged

## Future Enhancements

- [ ] Webhook support (instant sync instead of polling)
- [ ] Two-way sync (Apollo → Notion)
- [ ] Rich text formatting in emails
- [ ] Attachment support
- [ ] Apollo API integration (skip email bridge)
- [ ] Slack notifications on sync
- [ ] Dashboard for sync status

## Support

Questions? Contact louis@mediar.ai
