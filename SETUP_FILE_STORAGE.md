# File Storage Setup Instructions

Follow these steps to enable workflow file storage and execution with external JavaScript files.

## 1. Supabase Configuration

### Create Storage Bucket
1. Go to your Supabase Dashboard > Storage
2. Click "New bucket"
3. Name: `workflow-files`
4. Public bucket: **No** (keep private)
5. File size limit: 50MB
6. Allowed MIME types: `application/javascript, text/javascript, application/x-javascript`

### Run Database Migration
```bash
# Apply the migration
npx supabase db push

# Or if using Supabase CLI directly:
supabase migration up
```

## 2. Environment Variables

### Local Development (.env.local)
```bash
# Add these to your .env.local
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
INTERNAL_API_KEY=your_internal_api_key_here
```

### Production (Vercel)
```bash
# Add to Vercel environment variables
npx vercel env add SUPABASE_SERVICE_ROLE_KEY
npx vercel env add INTERNAL_API_KEY
```

## 3. Deploy Modal Functions

### Deploy the cleanup tasks
```bash
cd modal_apps
modal deploy cleanup_tasks.py
```

### Deploy updated workflow executor
```bash
modal deploy workflow_executor.py
```

### Verify deployment
```bash
modal app list
# Should show:
# - workflow-executor
# - workflow-cleanup-tasks
```

## 4. Test the Implementation

### Test 1: Upload Workflow with Files
```bash
# Run the test upload script
node test-workflow-upload.js

# Expected output:
# ✓ Added terminator.yml to ZIP
# ✓ Added scripts/validator.js to ZIP
# ✓ Added scripts/processor.js to ZIP
# ✓ Added config/settings.js to ZIP
# ✓ Created ZIP file
# ✓ Upload successful!
# Files uploaded to storage
```

### Test 2: Execute Workflow
```bash
# Test with curl
curl -X POST http://localhost:3000/api/workflows/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": 1,
    "machineId": 1,
    "parameters": {}
  }'
```

### Test 3: Manual Cleanup Test
```bash
# Test cleanup function
modal run cleanup_tasks.py::manual_cleanup --machine-id 1

# Test statistics update
modal run cleanup_tasks.py::update_cache_statistics
```

## 5. Monitor Storage Usage

### Check Storage Usage
```sql
-- Run in Supabase SQL Editor
SELECT
    COUNT(*) as total_files,
    SUM(file_size) / 1048576.0 as total_size_mb,
    COUNT(DISTINCT workflow_id) as unique_workflows
FROM workflow_files;
```

### Check Cache Status
```sql
-- Check cache on all machines
SELECT
    m.name as machine_name,
    COUNT(c.*) as cached_files,
    SUM(c.file_size) / 1048576.0 as cache_size_mb,
    MAX(c.last_accessed) as last_activity
FROM remote_machines m
LEFT JOIN machine_file_cache c ON m.id = c.machine_id
GROUP BY m.id, m.name;
```

## 6. Troubleshooting

### Issue: Files not uploading
1. Check Supabase Storage bucket exists and is named `workflow-files`
2. Verify SUPABASE_SERVICE_ROLE_KEY is set correctly
3. Check browser console for detailed error messages

### Issue: Files not downloading on execution
1. Verify Modal secrets are configured:
   ```bash
   modal secret list
   # Should include: supabase-db
   ```
2. Check Modal function logs:
   ```bash
   modal logs workflow-executor
   ```

### Issue: Storage filling up
1. Run manual cleanup:
   ```bash
   modal run cleanup_tasks.py::cleanup_file_cache
   ```
2. Adjust cleanup policy in database:
   ```sql
   UPDATE file_cleanup_policy
   SET max_age_days = 3  -- More aggressive cleanup
   WHERE policy_name = 'cache_cleanup';
   ```

## 7. Production Checklist

- [ ] Storage bucket created in Supabase
- [ ] Environment variables set in Vercel
- [ ] Database migration applied
- [ ] Modal functions deployed
- [ ] Test workflow uploaded successfully
- [ ] Test workflow executed successfully
- [ ] Cleanup tasks running on schedule
- [ ] Monitoring queries saved

## 8. API Endpoints

### Upload Workflow ZIP
```
POST /api/workflows/upload-zip
Content-Type: multipart/form-data
Body: file (ZIP), workflowId (optional)
```

### Execute Workflow
```
POST /api/workflows/execute
Content-Type: application/json
Body: { workflowId, machineId, parameters }
```

### Get Workflow Files
```
GET /api/workflows/:id/files
Returns: List of files with signed URLs
```

## Notes

- Files are deduplicated using SHA256 hashing
- Signed URLs expire after 1 hour by default
- Cache cleanup runs every 6 hours
- Orphaned file cleanup runs daily
- Maximum file size: 50MB per file
- Supported file types: .js files only