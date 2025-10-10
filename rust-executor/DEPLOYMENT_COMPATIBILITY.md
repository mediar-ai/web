# Rust Executor → Dashboard Compatibility Analysis

## ⚠️ **Answer: NO - Not a drop-in replacement yet**

While the Rust executor has all the core functionality, there are **key differences** that would require dashboard updates before swapping.

---

## 🔴 **Breaking Differences**

### 1. **Queue Processing Model**
**Modal (Current):**
- Uses polling scheduler that queries `workflow_executions` table
- Picks up `status='queued'` rows and executes them
- Updates status to `running` → `completed`/`failed`
- Runs in Modal's managed environment with auto-scaling

**Rust Executor (Current):**
- Provides REST API endpoints only
- Does NOT poll the database for queued executions
- Requires external service to:
  1. Query DB for queued jobs
  2. POST to `/api/v1/executions` endpoint
  3. Monitor execution status

**Impact:** Dashboard creates executions with `status='queued'` expecting Modal to pick them up automatically. Rust executor won't see these.

---

### 2. **Database Integration**
**Modal:**
```python
# Polls workflow_executions table
executions = query("SELECT * FROM workflow_executions WHERE status='queued'")
# Updates directly
update("UPDATE workflow_executions SET status='running' WHERE id=...")
```

**Rust Executor:**
```rust
// Expects API calls to create executions
POST /api/v1/executions {
  "workflow_id": "uuid",
  "execution_params": {...}
}
// Returns execution_id for tracking
```

**Impact:** Dashboard would need to:
- Call Rust API instead of inserting DB rows directly
- Poll `/api/v1/executions/{id}` for status instead of querying DB

---

### 3. **Response Format Differences**

**Dashboard expects (from Modal via DB):**
```typescript
{
  id: number,                    // Database auto-increment ID
  workflow_id: number,
  status: 'queued' | 'running' | 'completed' | 'failed',
  modal_call_id: string,
  execution_params: object,
  result: object | null,
  error_message: string | null,
  created_at: timestamp,
  started_at: timestamp,
  completed_at: timestamp,
  assigned_machine_id: number,
  mcp_endpoint: string
}
```

**Rust executor returns:**
```rust
{
  execution_id: "uuid",          // UUID, not number
  workflow_id: "uuid",           // UUID, not number
  status: "Queued" | "Running" | "Completed" | "Failed",
  message: string,
  result: object | null,
  error: string | null,
  started_at: timestamp | null,
  completed_at: timestamp | null
}
```

**Impact:**
- ID format mismatch (UUID vs integer)
- Field name differences (`error` vs `error_message`)
- Status capitalization differences

---

### 4. **Machine Assignment**
**Dashboard code expects:**
```typescript
// Line 332-442 in execute route
assigned_machine_id: number
mcp_endpoint: string
assignment_reason: string
```

**Rust executor:**
- Has machine concept in queue processor (not yet connected)
- API doesn't currently handle machine assignment
- Would need to add this logic

---

## 🟡 **Compatible Features**

✅ **Workflow execution logic** - Both support same workflow format
✅ **MCP integration** - Both use MCP tools via RMCP
✅ **GitHub loading** - Both load workflows from GitHub
✅ **Error strategies** - Both support retry/continue/stop/fallback
✅ **Parameter validation** - Both validate execution params

---

## 🔧 **What Needs to Be Built**

### Option A: Make Rust Executor Queue-Compatible (Recommended)
Add queue polling to Rust executor:

```rust
// New background service
async fn queue_processor_loop() {
    loop {
        // 1. Poll database for queued executions
        let queued = db.query("SELECT * FROM workflow_executions WHERE status='queued'")

        // 2. Claim and execute
        for execution in queued {
            db.update("UPDATE workflow_executions SET status='running'...")
            let result = execute_workflow(execution).await
            db.update("UPDATE workflow_executions SET status='completed', result=...")
        }

        sleep(Duration::from_secs(5)).await
    }
}
```

**Pros:**
- Drop-in replacement for Modal
- No dashboard changes needed
- Uses existing DB schema

**Cons:**
- Adds database dependency
- Polling overhead

---

### Option B: Update Dashboard to Use REST API
Change dashboard to call Rust API directly:

```typescript
// Current (Modal)
await supabase.from('workflow_executions').insert({
  workflow_id, status: 'queued', ...
})

// New (Rust API)
const response = await fetch('https://rust-executor.azure.com/api/v1/executions', {
  method: 'POST',
  body: JSON.stringify({
    workflow_id: uuidFromDB,
    execution_params: params,
    mcp_endpoint: machineEndpoint
  })
})
```

**Pros:**
- True REST architecture
- No polling needed
- Better separation of concerns

**Cons:**
- Requires dashboard code changes
- Need to migrate ID format (int → UUID)
- Status tracking changes

---

## 📋 **Required Changes for Dashboard Compatibility**

### Minimal (Option A - Queue Polling):
1. ✅ Add `QueueProcessor` implementation (already in code, needs activation)
2. ✅ Connect to PostgreSQL on startup
3. ✅ Add machine assignment logic from DB
4. ✅ Use database IDs instead of UUIDs for compatibility
5. ⚠️ Match exact DB schema (field names, types)

### Full REST Migration (Option B):
1. Update `/api/remote-workflows/[workflowId]/execute/route.ts`
2. Change from DB insert to HTTP POST to Rust API
3. Update execution status polling to call Rust API
4. Migrate execution IDs from integer to UUID
5. Update all dashboard components using execution data

---

## 🎯 **Recommendation**

**Implement Option A first:**
1. Activate the existing `QueueProcessor` in Rust executor
2. Connect to the same PostgreSQL database Modal uses
3. Use the **exact same table schema** for compatibility
4. Deploy alongside Modal (both polling same queue)
5. Gradually migrate workloads to Rust
6. Sunset Modal once stable

**This allows:**
- Zero dashboard changes
- Gradual migration with rollback capability
- A/B testing between Modal and Rust
- Shared queue for load distribution

---

## ✅ **Timeline to Production-Ready**

### Current State:
- ✅ Core execution logic works
- ✅ MCP integration functional
- ✅ Workflow validation working
- ✅ Docker containerization ready
- ✅ API endpoints defined

### Needed (Est. 4-8 hours):
- ⏱️ Activate queue processor (2-3 hrs)
- ⏱️ Add database schema matching (1-2 hrs)
- ⏱️ Add machine assignment logic (1-2 hrs)
- ⏱️ Integration testing with real DB (1-2 hrs)
- ⏱️ Deploy to Azure + monitoring (1 hr)

### Total: **1-2 days** for full compatibility

---

## 💡 **Immediate Next Steps**

If deploying to Azure NOW:
1. ✅ Deploy as standalone API (works fine)
2. ⚠️ Dashboard won't auto-connect (different architecture)
3. 🔧 Can test manually via curl/Postman
4. 📊 Won't see executions in dashboard automatically

**For dashboard integration, choose:**
- **Quick path:** Complete Option A queue polling
- **Future-proof:** Migrate dashboard to Option B REST API

---

**Bottom line:** The Rust executor is **technically ready** but **architecturally different** from Modal. It needs queue polling added OR dashboard needs API migration to be a true drop-in replacement.