# Executor Selection Feature

## Overview
The executor selection feature allows Mediar team members to choose between Python (Modal) and Rust (Azure) executors when running workflows. This provides flexibility for testing, debugging, and performance optimization.

## Implementation Summary

### Frontend Changes
- **File:** `src/components/deployments/BatchTestDialog.tsx`
- **Changes:**
  - Added executor type selection dropdown (lines 755-774)
  - Added `executorType` state with default value 'python'
  - Integrated `isMediarTeam` prop for conditional rendering
  - Updated `handleBatchSubmit` to include `executor_type` in API request
  - Reset executor type when dialog closes

### Backend Changes
- **File:** `src/app/api/remote-workflows/[workflowId]/batch-execute/route.ts`
- **Changes:**
  - Extract `executor_type` from request body (default: 'python')
  - Store `executor_type` in workflow_executions table via jobsToInsert array
  - Maintains backward compatibility with NULL values

### Rust Executor Changes
- **File:** `rust-executor/src/db/queries.rs`
- **Changes:**
  - Updated `claim_execution` query to filter: `AND (executor_type = 'rust' OR executor_type IS NULL)`
  - Ensures Rust executor only claims jobs marked for Rust or legacy NULL jobs

### Python Executor Changes
- **File:** `modal_apps/workflow_executor.py`
- **Changes:**
  - Updated claim query to filter: `AND (we.executor_type = 'python' OR we.executor_type IS NULL)`
  - Ensures Python executor only claims jobs marked for Python or legacy NULL jobs

## Architecture

### Job Routing Flow
```
User selects executor in UI
        ↓
Frontend sends executor_type in API request
        ↓
Backend stores executor_type in workflow_executions table
        ↓
        ├─→ Python executor claims jobs where executor_type = 'python' OR NULL
        └─→ Rust executor claims jobs where executor_type = 'rust' OR NULL
```

### Executor Endpoints

#### Python Executor (Modal)
- **Platform:** Modal serverless
- **Status:** Production-ready
- **Default:** Yes (executor_type defaults to 'python')

#### Rust Executor (Azure Container Instances)
- **URL:** http://workflow-executor-dev.eastus.azurecontainer.io:8080
- **Health Check:** http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
- **Queue Status:** http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/queue/status
- **Status:** Experimental (deployed and healthy)
- **Polling:** Every 5 seconds for new jobs

## Current Status

### Deployment Verification (2025-10-15)
```bash
# Health check
$ curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
{"status":"healthy","version":"0.1.0"}

# Queue status
$ curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/queue/status
{
  "queued_count": 1,
  "running_count": 1,
  "failed_count": 28,
  "completed_count": 281
}
```

**Rust executor is deployed, healthy, and actively processing jobs** ✅

## Testing Procedure

### Prerequisites
1. User must be Mediar team member (email ends with @mediar.ai OR member of Mediar organization)
2. At least one deployed workflow available for testing
3. Rust executor must be running (verify health endpoint)

### Test Steps

#### Test 1: UI Visibility Check
1. Navigate to `/deployments` page
2. Open batch test dialog for any workflow
3. **Expected:** "Executor Type" dropdown is visible (Mediar team only)
4. **Expected:** Default selection is "Python Executor (Default)"

#### Test 2: Python Executor Test (Default Behavior)
1. Open batch test dialog
2. Leave executor as "Python Executor (Default)"
3. Configure test parameters and run batch
4. **Expected:** Jobs are queued with `executor_type = 'python'`
5. **Expected:** Python (Modal) executor claims and processes jobs
6. Verify execution completes successfully

#### Test 3: Rust Executor Test
1. Open batch test dialog
2. Select "Rust Executor (Experimental)" from dropdown
3. Configure test parameters and run batch
4. **Expected:** Jobs are queued with `executor_type = 'rust'`
5. **Expected:** Rust (Azure) executor claims and processes jobs
6. Monitor at: http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/queue/status
7. Verify execution completes successfully

#### Test 4: Backward Compatibility
1. Queue a workflow via direct API call without `executor_type` parameter
2. **Expected:** `executor_type` is NULL in database
3. **Expected:** Python executor (default) claims the job
4. Verify execution completes successfully

### Verification Queries

```sql
-- Check executor_type distribution
SELECT
  executor_type,
  status,
  COUNT(*) as count
FROM workflow_executions
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY executor_type, status
ORDER BY executor_type, status;

-- Check latest Rust executor jobs
SELECT
  id,
  workflow_id,
  executor_type,
  status,
  machine_id,
  created_at,
  started_at,
  completed_at
FROM workflow_executions
WHERE executor_type = 'rust'
ORDER BY created_at DESC
LIMIT 10;
```

## Monitoring

### Rust Executor Logs
```bash
# View container logs
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg

# Restart container if needed
az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg

# Check container status
az container show -n workflow-executor-dev -g mediar-workflow-executor-rg \
  --query "{Status:instanceView.state,IP:ipAddress.ip,FQDN:ipAddress.fqdn}"
```

### Python Executor Logs
- Check Modal dashboard for function logs
- Monitor via existing production monitoring

## Known Limitations

1. **Experimental Status:** Rust executor is in experimental phase
2. **Team Only:** Executor selection only visible to Mediar team members
3. **Default Behavior:** All executions default to Python for safety
4. **NULL Handling:** Legacy jobs without executor_type are claimed by both executors (first to claim wins)

## Security Considerations

1. **Team Restriction:** Only Mediar team can select executor type
2. **Default Safety:** Python executor is the default for all users
3. **Backward Compatible:** Existing integrations continue to work without changes
4. **Database Filtering:** Executors are isolated at the database query level

## Future Enhancements

1. Add executor performance metrics dashboard
2. Implement automatic executor selection based on workflow characteristics
3. Add executor preference settings at workflow level
4. Create executor health monitoring and alerting
5. Expand Rust executor availability to non-Mediar users after validation

## Rollback Plan

If issues arise with executor selection:

1. **Immediate:** Set all new executions to `executor_type = 'python'` in backend
2. **Short-term:** Hide executor dropdown from frontend (remove `isMediarTeam` conditional)
3. **Database cleanup:** Update any stuck 'rust' jobs to 'python':
   ```sql
   UPDATE workflow_executions
   SET executor_type = 'python'
   WHERE executor_type = 'rust'
   AND status = 'queued';
   ```

## Files Modified

### Frontend
- `src/components/deployments/BatchTestDialog.tsx`
- `src/app/deployments/page.tsx`

### Backend
- `src/app/api/remote-workflows/[workflowId]/batch-execute/route.ts`

### Executors
- `rust-executor/src/db/queries.rs`
- `modal_apps/workflow_executor.py`

## Contact

For issues or questions about executor selection:
- Check Rust executor health: http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
- Review deployment docs: `rust-executor/DEPLOYMENT_SUCCESS.md`
- Check container logs: `az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg`
