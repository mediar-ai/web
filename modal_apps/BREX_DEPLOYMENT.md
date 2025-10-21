# Brex to PostHog Modal Deployment Guide

## Overview

This Modal app automatically syncs Brex financial data to PostHog on a daily schedule.

**App Name**: `brex-posthog-sync`
**Schedule**: Daily at 9:00 AM UTC
**File**: `brex_posthog_sync.py`

## Features

- ✅ Fetches account balances from all Brex cash accounts
- ✅ Fetches last 7 days of cash transactions
- ✅ Fetches last 7 days of card transactions (with pagination)
- ✅ Sends 3 types of events to PostHog:
  - `brex_account_balance` - Current balances
  - `brex_7_day_summary` - 7-day financial summary
  - `brex_daily_metrics` - Daily breakdowns for trending

## Deployment

### Prerequisites

1. **Modal account** with authentication set up
2. **Brex API token** with proper scopes
3. **PostHog API key** from your project

### Step 1: Test Locally

```bash
cd C:\Users\screenpipe-windows\mediar-web-app-workspace\modal_apps
modal run brex_posthog_sync.py
```

This will run the sync once immediately for testing.

### Step 2: Deploy to Modal

```bash
cd C:\Users\screenpipe-windows\mediar-web-app-workspace\modal_apps
modal deploy brex_posthog_sync.py
```

This deploys the app with the daily schedule (9 AM UTC).

### Step 3: Verify Deployment

```bash
# List all apps
modal app list

# Check logs
modal app logs brex-posthog-sync

# View next scheduled run
modal app show brex-posthog-sync
```

## Configuration

### Credentials (Hardcoded)

The app uses these credentials (already set in the code):

```python
BREX_API_TOKEN = "bxt_DLh3v9PnARZ8P7GeHQXbKlQDt4LtQjewo1sX"
POSTHOG_API_KEY = "phc_NFSaZUao49XckpqaeyB3lIEKrFXhhXbKaI81jqZ8yn9"
POSTHOG_HOST = "https://eu.i.posthog.com"
POSTHOG_DISTINCT_ID = "brex-integration"
```

### Schedule

Default: **Daily at 9:00 AM UTC** (1:00 AM PST / 4:00 AM EST)

To change the schedule, edit this line in `brex_posthog_sync.py`:

```python
schedule=modal.Cron("0 9 * * *")  # Cron format
```

Examples:
- Every 6 hours: `"0 */6 * * *"`
- Twice daily (9 AM & 9 PM): `"0 9,21 * * *"`
- Every weekday at 8 AM: `"0 8 * * 1-5"`

## PostHog Events

### 1. `brex_account_balance`

Sent once per run with current account balances.

**Properties:**
- `total_balance_usd` (number)
- `accounts` (array):
  - `name` (string)
  - `balance_usd` (number)
  - `status` (string)
  - `primary` (boolean)

### 2. `brex_7_day_summary`

Sent once per run with 7-day transaction summary.

**Properties:**
- `total_transactions` (number)
- `cash_income_usd` (number)
- `cash_income_count` (number)
- `cash_expenses_usd` (number)
- `cash_expenses_count` (number)
- `card_expenses_usd` (number)
- `card_expenses_count` (number)
- `total_expenses_usd` (number)
- `net_amount_usd` (number)

### 3. `brex_daily_metrics`

Sent 7 times per run (one for each of last 7 days).

**Properties:**
- `date` (string, YYYY-MM-DD)
- `cash_income_usd` (number)
- `cash_expenses_usd` (number)
- `card_expenses_usd` (number)
- `total_expenses_usd` (number)
- `transaction_count` (number)

## Monitoring

### View Logs

```bash
# Stream live logs
modal app logs brex-posthog-sync --follow

# View recent logs
modal app logs brex-posthog-sync
```

### Check Status

```bash
# App details
modal app show brex-posthog-sync

# List all scheduled runs
modal app list
```

### Trigger Manual Run

```bash
# Run immediately (bypasses schedule)
modal run brex_posthog_sync.py
```

## Troubleshooting

### "No accounts found"
- Check that `BREX_API_TOKEN` is valid
- Verify token has `accounts.cash.readonly` scope

### "Error sending to PostHog"
- Verify `POSTHOG_API_KEY` is correct
- Check `POSTHOG_HOST` matches your region (EU/US)

### "Missing BREX_API_TOKEN"
- Modal secrets not configured properly
- Redeploy with `modal deploy brex_posthog_sync.py`

## Cost Estimate

**Modal Costs** (approximate):
- Function runs: Daily (1x per day)
- Runtime: ~30-60 seconds per run
- Cost: **~$0.01/month** (well within free tier)

**PostHog Costs**:
- Events sent: 9 events/day (1 + 1 + 7)
- Monthly: ~270 events
- Cost: **Free** (within PostHog's free tier)

## Updating Credentials

If you need to update Brex or PostHog credentials:

1. Edit `brex_posthog_sync.py`
2. Update the `modal.Secret.from_dict()` values
3. Redeploy:
   ```bash
   modal deploy brex_posthog_sync.py
   ```

## Undeploying

To stop the scheduled sync:

```bash
modal app stop brex-posthog-sync
```

To completely remove the app:

```bash
modal app delete brex-posthog-sync
```

## Next Steps

After deployment:

1. ✅ Verify first run in Modal logs
2. ✅ Check PostHog for incoming events
3. ✅ Create PostHog dashboard with visualizations:
   - Balance trend chart
   - Daily expenses breakdown
   - Income vs expenses comparison
   - Transaction volume over time
