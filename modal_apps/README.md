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

## Deployment Commands

### Deploy Sequential Processor
```bash
cd modal-apps
modal deploy sequential_processor.py
```

## Database Tables Used

### Sequential Processor
- `low_level_events` - Source events to process
- `low_level_workflow_analyses` - Generated analyses
- `processing_locks` - Prevents duplicate processing

## Environment Variables Required

The sequential processor requires these Modal secrets:
- `supabase-secret` - Contains `SUPABASE_CONN_STRING`
- `custom-secret` - Contains `VERCEL_URL`

## Monitoring

- View logs: `modal app logs <app-id>`
- Check status: `modal app list`
- View containers: `modal container list` 
