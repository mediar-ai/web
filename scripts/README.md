# Admin Scripts

## Add Mediar Admins to All Organizations

This script adds `louis@mediar.ai` and `matt@mediar.ai` as admins to all existing organizations in Clerk.

### Prerequisites

1. Make sure you have the `CLERK_SECRET_KEY` environment variable set
2. Install dependencies: `npm install`

### Usage

```bash
# Run the script
npx tsx scripts/add-admins-to-all-orgs.ts
```

### What it does

1. Fetches all organizations from Clerk
2. For each organization:
   - Checks if louis@mediar.ai and matt@mediar.ai are already members
   - If they're not members:
     - If the user exists in Clerk: adds them directly as `org:admin`
     - If the user doesn't exist: sends an invitation as `org:admin`

### Future Organizations

For new organizations created going forward, the Clerk webhook (`/api/webhooks/clerk`) will automatically invite both admins when an organization is created.

### Setup Clerk Webhook

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to Webhooks
3. Add a new endpoint: `https://yourdomain.com/api/webhooks/clerk`
4. Subscribe to the `organization.created` event
5. Copy the webhook secret and set it as `CLERK_WEBHOOK_SECRET` in your environment variables
