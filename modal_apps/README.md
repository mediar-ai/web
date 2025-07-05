# Modal Applications

This directory contains Modal serverless applications for the browser workflow capture system.

## Active Applications

### 1. Sequential Processor (`sequential_processor.py`)
- **Purpose**: Processes UI tree events and generates workflow analyses using LLM
- **Status**: ✅ Currently deployed and running
- **Schedule**: Every 2 minutes
- **App Name**: `sequential-workflow-processor`

**Functions:**
- `scheduled_processing()` - Runs every 2 minutes to find and process unprocessed events
- `process_all_events_for_user(user_id)` - Processes all events for a specific user
- `trigger_full_parallel_processing()` - Manually triggers processing for all users
- `emergency_cleanup_all_processing_locks()` - Emergency cleanup function
- `get_processing_status()` - Returns processing statistics

### 2. Screenshot Processor (`screenshot_processor.py`)
- **Purpose**: Extracts screenshots from events and uploads them to Supabase storage
- **Status**: ⚠️ Not currently deployed (but functional)
- **Schedule**: Every 3 minutes (when deployed)
- **App Name**: `screenshot-processor`

**Functions:**
- `scheduled_screenshot_processing()` - Processes screenshots on schedule
- `process_screenshots(batch_size)` - Processes a batch of screenshot events
- `get_stats()` - Returns processing statistics
- API endpoints for manual triggering and debugging

## Deployment Commands

### Deploy Sequential Processor
```bash
cd modal-apps
modal deploy sequential_processor.py
```

### Deploy Screenshot Processor
```bash
cd modal-apps
modal deploy screenshot_processor.py
```

## Database Tables Used

### Sequential Processor
- `low_level_events` - Source events to process
- `low_level_workflow_analyses` - Generated analyses
- `processing_locks` - Prevents duplicate processing

### Screenshot Processor
- `low_level_events` - Source screenshot events
- `low_level_processed_screenshots` - Processing status and metadata

## Environment Variables Required

Both applications require these Modal secrets:
- `supabase-secret` - Contains `SUPABASE_CONN_STRING`
- `custom-secret` - Contains `VERCEL_URL` (for sequential processor)

## Monitoring

- View logs: `modal app logs <app-id>`
- Check status: `modal app list`
- View containers: `modal container list` 