# Notion → Apollo Sync Setup Checklist

Quick setup guide for the automated Notion meeting notes → Apollo CRM sync.

## ✅ Setup Checklist

### 1. Notion Setup
- [ ] Create Notion integration at https://www.notion.so/my-integrations
- [ ] Copy integration token → `NOTION_API_KEY`
- [ ] Share meeting notes database with integration
- [ ] Copy database ID from URL → `NOTION_DATABASE_ID`
- [ ] Verify database has `Name/Title` and `Email` properties

### 2. Apollo Setup
- [ ] Get Apollo email ingestion address (contact support)
- [ ] Set `APOLLO_INGEST_EMAIL=workspace@ingest.apollo.io`
- [ ] Test that email ingestion works

### 3. Resend Setup
- [ ] Sign up at https://resend.com
- [ ] Create API key → `RESEND_API_KEY`
- [ ] Verify sending domain (mediar.ai)
- [ ] Set `RESEND_FROM_EMAIL=meetings@mediar.ai`

### 4. Database Setup
- [ ] Run migration: `supabase/migrations/20251107_notion_apollo_sync.sql`
- [ ] Verify tables created:
  - `notion_apollo_sync_state`
  - `notion_apollo_synced_pages`

### 5. Environment Variables
- [ ] Copy `.env.notion-apollo-sync.example` values to `.env`
- [ ] Set all 4 required env vars:
  ```bash
  NOTION_API_KEY=secret_...
  NOTION_DATABASE_ID=...
  APOLLO_INGEST_EMAIL=...
  RESEND_API_KEY=re_...
  ```

### 6. Deploy
- [ ] Commit and push to main
- [ ] Verify Vercel deployment succeeds
- [ ] Check cron job registered: Vercel Dashboard → Cron

### 7. Test
- [ ] Create test meeting note in Notion with email
- [ ] Wait 15 mins or trigger manually:
  ```bash
  curl -X POST https://app.mediar.ai/api/cron/sync-notion-to-apollo
  ```
- [ ] Check Vercel logs for success
- [ ] Verify note appears in Apollo on contact

## 🚀 Quick Test

```bash
# 1. Create test meeting in Notion
# 2. Run sync manually
curl -X POST http://localhost:3000/api/cron/sync-notion-to-apollo

# 3. Check database
psql $DATABASE_URL
SELECT * FROM notion_apollo_synced_pages;

# 4. Verify in Apollo CRM
```

## 📊 Monitoring

**Vercel Dashboard:**
- Functions → Logs → Filter `sync-notion-to-apollo`
- Look for: `syncedCount`, `failedCount`

**Supabase Dashboard:**
```sql
-- Recent syncs
SELECT * FROM notion_apollo_synced_pages
ORDER BY synced_at DESC LIMIT 10;

-- Last sync time
SELECT * FROM notion_apollo_sync_state;
```

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| Missing env vars | Check all 4 are set in Vercel dashboard |
| Email not sent | Verify Resend domain is verified |
| No notes in Apollo | Check Apollo ingestion email is correct + CC'd |
| Duplicate syncs | Clear `notion_apollo_synced_pages` entry |

## 📚 Full Documentation

See `docs/notion-apollo-sync.md` for complete details.

## 💰 Cost

**Free tier covers ~20 meetings/day**
- Notion API: Free (1000 req/hr)
- Resend: Free (100 emails/day)
- Vercel Cron: Free
- Supabase: Free tier

---

**Questions?** louis@mediar.ai
