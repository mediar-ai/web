# Intelligent Retry Mechanism for Workflow Executions

## Problem Statement

Currently, when a workflow execution fails (e.g., VM is down for maintenance), the execution is marked as failed and no retry occurs. This means:

- ❌ Infrastructure failures (VM down, network issues) require manual retries
- ❌ Workflow logic errors are treated the same as infra errors
- ❌ No distinction between retryable and non-retryable failures

## Solution: Smart Infrastructure-Level Retries

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Queue Processor                       │
│                                                          │
│  1. Claim execution from queue                           │
│  2. Try to execute workflow                              │
│  3. On failure → Classify error type                     │
│      ├─ Infrastructure error? → Retry with backoff       │
│      ├─ Workflow logic error? → Mark as failed, NO retry│
│      └─ Unknown error? → Mark as failed, NO retry       │
└─────────────────────────────────────────────────────────┘
```

### Error Classification

The system classifies errors into 3 categories:

#### 1. **Infrastructure Errors** (RETRY automatically)
```rust
// Network/Connection errors
"connection refused", "connection timeout", "network unreachable"

// HTTP server errors
"500", "502", "503", "504"

// MCP/Service errors
"mcp service unavailable", "failed to create http mcp service"

// VM/Machine errors
"vm is down", "machine not responding", "health check failed"

// Timeout errors
"timeout", "deadline exceeded"
```

#### 2. **Workflow Logic Errors** (DO NOT retry)
```rust
// Validation errors
"validation failed", "invalid input", "missing required"

// Business logic errors
"record not found", "permission denied", "already exists"

// Step execution errors
"step failed", "assertion failed", "condition not met"
```

#### 3. **Unknown Errors** (DO NOT retry - be conservative)
Any error that doesn't match the above patterns

### Retry Strategy

**Exponential Backoff with Jitter:**

```
Attempt 0: 30 seconds
Attempt 1: 60 seconds  (30 * 2^1)
Attempt 2: 120 seconds (30 * 2^2)
Attempt 3: 240 seconds (30 * 2^3)
Max delay: 600 seconds (10 minutes)
```

**Configuration (`RetryConfig`):**
```rust
max_infrastructure_retries: 3      // Max retry attempts
initial_delay_secs: 30             // First retry after 30s
max_delay_secs: 600                // Cap delays at 10min
backoff_multiplier: 2.0            // Double each time
enabled: true                      // Enable queue-level retries
```

## Implementation Plan

### Phase 1: Add Retry Config (✅ DONE)

Created `src/config/retry.rs` with:
- `RetryConfig` struct for configuration
- `classify_error()` function to categorize errors
- Unit tests for error classification

### Phase 2: Update Database Schema

Add retry tracking columns to `workflow_executions`:

```sql
ALTER TABLE workflow_executions
ADD COLUMN retry_count INTEGER DEFAULT 0,
ADD COLUMN max_retries INTEGER DEFAULT 0,
ADD COLUMN next_retry_at TIMESTAMPTZ NULL,
ADD COLUMN is_retryable BOOLEAN DEFAULT FALSE,
ADD COLUMN error_category TEXT NULL; -- 'infrastructure', 'workflow_logic', 'unknown'
```

### Phase 3: Update Queue Processor

Modify `queue_processor.rs` to:

1. **On execution failure**, classify the error:
```rust
let error_category = classify_error(&error_message);

if error_category == ErrorCategory::Infrastructure {
    // Schedule retry
    let retry_count = execution.retry_count + 1;
    let max_retries = config.max_infrastructure_retries;

    if retry_count <= max_retries {
        let delay = config.calculate_delay(retry_count);
        let next_retry_at = Utc::now() + delay;

        WorkflowQueries::schedule_retry(
            &db_pool,
            execution.id,
            retry_count,
            next_retry_at,
            error_category
        ).await?;

        info!(
            "Execution {} scheduled for retry {}/{} at {}",
            execution.id, retry_count, max_retries, next_retry_at
        );
    } else {
        // Max retries exceeded
        WorkflowQueries::mark_failed_permanently(
            &db_pool,
            execution.id,
            "Max infrastructure retries exceeded"
        ).await?;
    }
} else {
    // Workflow logic error or unknown - mark as failed, no retry
    WorkflowQueries::mark_failed_permanently(
        &db_pool,
        execution.id,
        error_message
    ).await?;
}
```

2. **When claiming executions**, include retryable executions:
```rust
WorkflowQueries::claim_execution(&db_pool, &machine_id).await

// Should claim:
// - New executions (status = 'queued')
// - Retryable executions (status = 'failed', next_retry_at <= NOW)
```

### Phase 4: Add Database Queries

Add to `db/queries.rs`:

```rust
pub async fn schedule_retry(
    pool: &DatabasePool,
    execution_id: i64,
    retry_count: u32,
    next_retry_at: DateTime<Utc>,
    error_category: ErrorCategory,
) -> Result<()> {
    sqlx::query!(
        "UPDATE workflow_executions
         SET status = 'queued',
             retry_count = $2,
             next_retry_at = $3,
             is_retryable = true,
             error_category = $4
         WHERE id = $1",
        execution_id,
        retry_count as i32,
        next_retry_at,
        format!("{:?}", error_category).to_lowercase()
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn claim_execution(
    pool: &DatabasePool,
    machine_id: &str,
) -> Result<Option<WorkflowExecution>> {
    let result = sqlx::query_as!(
        WorkflowExecution,
        "UPDATE workflow_executions
         SET status = 'running',
             started_at = NOW(),
             claimed_by = $1
         WHERE id IN (
             SELECT id FROM workflow_executions
             WHERE (
                 status = 'queued'
                 OR (status = 'failed' AND is_retryable = true AND next_retry_at <= NOW())
             )
             ORDER BY
                 priority DESC,
                 retry_count ASC,  -- Prioritize fresh attempts over retries
                 queued_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING *",
        machine_id
    )
    .fetch_optional(pool)
    .await?;

    Ok(result)
}
```

## Workflow-Level Retries (User-Defined)

For **business logic retries**, the workflow itself should handle retry:

### Example: TypeScript Workflow with Retry

```typescript
// src/terminator.ts
import { executeStep, retry } from '@mediar/workflow-sdk';

export default async function workflow(inputs: any) {
  // Infrastructure retries handled automatically by executor

  // Workflow-level retry for business logic
  const result = await retry(
    async () => {
      // This might fail due to business logic (e.g., API rate limit)
      return await executeStep('api_call', {
        url: inputs.apiUrl
      });
    },
    {
      maxAttempts: 3,
      delayMs: 1000,
      backoffMultiplier: 2,
      retryOn: ['rate_limit_exceeded', 'temporary_error']
    }
  );

  return result;
}
```

### Example: YAML Workflow with Retry

```yaml
name: API Data Fetch with Retry
steps:
  - step_name: fetch_data
    tool_name: http_request
    retry:
      max_attempts: 3
      delay_ms: 1000
      retry_on:
        - status_code: 429  # Rate limit
        - status_code: 503  # Service unavailable
      backoff_multiplier: 2
    arguments:
      url: "https://api.example.com/data"
      method: GET
```

## Configuration via Environment Variables

```bash
# .env or Azure Container Instance environment
RETRY_ENABLED=true
RETRY_MAX_INFRASTRUCTURE_RETRIES=3
RETRY_INITIAL_DELAY_SECS=30
RETRY_MAX_DELAY_SECS=600
RETRY_BACKOFF_MULTIPLIER=2.0
```

## Benefits

### ✅ **Automatic Recovery**
- VM maintenance/restart → workflows resume automatically
- Network blip → execution retries after 30s
- MCP service restart → no manual intervention needed

### ✅ **Smart Classification**
- Workflow bugs don't trigger infinite retries
- Validation errors fail immediately
- Infrastructure issues get automatic retry

### ✅ **User Control**
- Disable retries via config if needed
- Workflow-level retries for business logic
- Observability: retry count visible in UI

### ✅ **Cost Efficient**
- Exponential backoff prevents resource waste
- Capped delays prevent indefinite waiting
- Max retries prevent infinite loops

## Monitoring & Observability

### Execution Status in UI

```
Execution #12345
Status: Retrying (attempt 2/3)
Next retry: in 60 seconds
Error: VM is down for maintenance
Category: Infrastructure
```

### Logs

```
[INFO] Execution 12345 failed: Connection refused
[INFO] Error classified as: Infrastructure
[INFO] Scheduling retry 1/3 in 30 seconds
[INFO] Execution 12345 requeued for retry at 2025-11-18 20:30:00
```

### Metrics

- Track retry success rate
- Measure time-to-recovery
- Alert on max retries exceeded

## Testing

### Unit Tests (✅ Included)
```bash
cd rust-executor
cargo test config::retry
```

### Integration Test
```bash
# 1. Stop MCP service on VM
ssh vm1 "sc stop mediar-mcp-agent"

# 2. Queue execution
curl -X POST http://localhost:8080/api/v1/workflows/123/execute

# 3. Verify retry scheduled
# Status: failed → queued
# retry_count: 1
# next_retry_at: +30 seconds

# 4. Wait 30 seconds, start MCP service
sleep 30
ssh vm1 "sc start mediar-mcp-agent"

# 5. Verify execution succeeds on retry
```

## Migration Path

1. ✅ Add retry config module (DONE)
2. Run database migration (add retry columns)
3. Deploy updated rust-executor with retry logic
4. Monitor retry metrics
5. Tune configuration based on real-world data

## Future Enhancements

- **Retry budget**: Limit total retry attempts per workflow per day
- **Circuit breaker**: Auto-pause workflows with high failure rates
- **Smart scheduling**: Retry during low-traffic periods
- **ML-based classification**: Learn from past failures to improve categorization
