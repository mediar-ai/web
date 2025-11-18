# Implementation Guide: Concurrent Execution + Smart Retries

This guide contains all code changes needed to add concurrent execution and intelligent retry mechanisms to the rust-executor.

## Overview

**Two major improvements:**
1. **Concurrent Execution**: Run 10-20 workflows simultaneously per executor instance (10x capacity increase)
2. **Smart Retries**: Automatically retry infrastructure failures, never retry workflow logic failures

## Step 1: Run Database Migration

```bash
# Apply the migration
cd /path/to/mediar-web-app
supabase db push

# Or manually apply:
psql $DATABASE_URL < supabase/migrations/20251118000000_add_retry_and_concurrency_support.sql
```

**What this does:**
- Adds retry tracking columns to `workflow_executions`
- Creates indexes for efficient queue claiming
- Marks existing failed executions as non-retryable

## Step 2: Update WorkflowExecution Model

**File:** `rust-executor/src/models/execution.rs`

Add these fields to the `WorkflowExecution` struct:

```rust
pub struct WorkflowExecution {
    pub id: i64,
    pub workflow_id: i64,
    pub status: ExecutionStatus,
    pub client_id: Option<String>,
    pub execution_params: Option<Value>,
    pub machine_id: Option<i32>,
    pub mcp_endpoint: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub result: Option<Value>,
    pub logs: Option<Value>,
    pub total_steps: Option<i32>,
    pub current_step: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,

    // NEW: Retry support
    pub retry_count: i32,
    pub max_retries: i32,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub is_retryable: bool,
    pub error_category: Option<String>,
}
```

## Step 3: Add Retry Queries

**File:** `rust-executor/src/db/queries.rs`

Add these new functions:

```rust
use crate::config::{classify_error, ErrorCategory, RetryConfig};

impl WorkflowQueries {
    // ... existing functions ...

    /// Schedule an execution for retry after infrastructure failure
    pub async fn schedule_retry(
        pool: &Pool<Postgres>,
        execution_id: i64,
        retry_count: i32,
        next_retry_at: DateTime<Utc>,
        error_category: ErrorCategory,
    ) -> Result<()> {
        let category_str = match error_category {
            ErrorCategory::Infrastructure => "infrastructure",
            ErrorCategory::WorkflowLogic => "workflow_logic",
            ErrorCategory::Unknown => "unknown",
        };

        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'queued',
                retry_count = $2,
                next_retry_at = $3,
                is_retryable = TRUE,
                error_category = $4,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(execution_id)
        .bind(retry_count)
        .bind(next_retry_at)
        .bind(category_str)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Mark execution as permanently failed (no more retries)
    pub async fn mark_failed_permanently(
        pool: &Pool<Postgres>,
        execution_id: i64,
        error_message: &str,
        error_category: ErrorCategory,
    ) -> Result<()> {
        let category_str = match error_category {
            ErrorCategory::Infrastructure => "infrastructure",
            ErrorCategory::WorkflowLogic => "workflow_logic",
            ErrorCategory::Unknown => "unknown",
        };

        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'failed',
                error_message = $2,
                is_retryable = FALSE,
                error_category = $3,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(execution_id)
        .bind(error_message)
        .bind(category_str)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Update claim_execution to include retryable executions
    pub async fn claim_execution(
        pool: &Pool<Postgres>,
        _machine_id: &str,
    ) -> Result<Option<WorkflowExecution>> {
        let result = sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'running',
                started_at = NOW(),
                updated_at = NOW()
            WHERE id = (
                SELECT id FROM workflow_executions
                WHERE (
                    -- Claim new queued executions
                    (status = 'queued' AND executor_type = 'rust')
                    OR
                    -- Claim retryable failed executions whose retry time has arrived
                    (
                        status = 'failed'
                        AND is_retryable = TRUE
                        AND next_retry_at <= NOW()
                        AND executor_type = 'rust'
                    )
                )
                ORDER BY
                    priority DESC NULLS LAST,
                    retry_count ASC,  -- Prioritize fresh attempts over retries
                    created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING
                id, workflow_id, status,
                client_id, execution_params, assigned_machine_id,
                mcp_endpoint,
                started_at, completed_at, error_message,
                results, execution_logs, total_steps,
                current_step_description, created_at, updated_at,
                retry_count, max_retries, next_retry_at,
                is_retryable, error_category
            "#,
        )
        .bind("running")
        .bind("queued")
        .fetch_optional(pool)
        .await?;

        if let Some(row) = result {
            Ok(Some(WorkflowExecution {
                id: row.get("id"),
                workflow_id: row.get("workflow_id"),
                status: Self::parse_execution_status(row.get("status")),
                client_id: row.get("client_id"),
                execution_params: row.get("execution_params"),
                machine_id: row.get("assigned_machine_id"),
                mcp_endpoint: row.get("mcp_endpoint"),
                started_at: row.get("started_at"),
                completed_at: row.get("completed_at"),
                error_message: row.get("error_message"),
                result: row.get("results"),
                logs: row.get("execution_logs"),
                total_steps: row.get("total_steps"),
                current_step: row.get("current_step_description"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                // NEW fields
                retry_count: row.get::<i32, _>("retry_count"),
                max_retries: row.get::<i32, _>("max_retries"),
                next_retry_at: row.get("next_retry_at"),
                is_retryable: row.get("is_retryable"),
                error_category: row.get("error_category"),
            }))
        } else {
            Ok(None)
        }
    }
}
```

## Step 4: Update Queue Processor with Retry Logic

**File:** `rust-executor/src/services/queue_processor.rs`

Add retry configuration and update error handling:

```rust
use crate::config::{classify_error, ErrorCategory, RetryConfig};
use tokio::sync::Semaphore;
use std::sync::Arc;

pub struct QueueProcessor {
    db_pool: DatabasePool,
    machine_id: String,
    monitor_client: MonitorClient,
    retry_config: RetryConfig,                     // NEW
    max_concurrent_executions: usize,              // NEW
}

impl QueueProcessor {
    pub fn new(db_pool: DatabasePool) -> Self {
        let machine_id = Self::generate_machine_id();
        let monitor_client = MonitorClient::new();

        // Load configuration from environment variables
        let retry_config = RetryConfig::default();
        let max_concurrent_executions = std::env::var("MAX_CONCURRENT_EXECUTIONS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10); // Default to 10 concurrent executions

        Self {
            db_pool,
            machine_id,
            monitor_client,
            retry_config,
            max_concurrent_executions,
        }
    }

    /// Start processing the queue with concurrency support
    pub async fn start(&self) -> Result<()> {
        info!(
            "Starting queue processor with machine_id: {} (max_concurrent: {})",
            self.machine_id, self.max_concurrent_executions
        );

        // Create semaphore for concurrency control
        let semaphore = Arc::new(Semaphore::new(self.max_concurrent_executions));
        let mut ticker = interval(Duration::from_secs(5));

        loop {
            ticker.tick().await;

            // Try to claim a new execution if we have capacity
            if semaphore.available_permits() > 0 {
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => continue, // No permits available
                };

                // Clone shared state for the spawned task
                let db_pool = self.db_pool.clone();
                let machine_id = self.machine_id.clone();
                let monitor_client = self.monitor_client.clone();
                let retry_config = self.retry_config.clone();

                // Spawn a new task to process this execution concurrently
                tokio::spawn(async move {
                    match Self::process_single_execution(
                        db_pool,
                        machine_id,
                        monitor_client,
                        retry_config,
                    )
                    .await
                    {
                        Ok(processed) => {
                            if processed {
                                info!("Successfully processed execution");
                            }
                        }
                        Err(e) => {
                            error!("Error processing execution: {}", e);
                        }
                    }

                    // Permit automatically released when dropped
                    drop(permit);
                });
            }
        }
    }

    /// Process a single execution (extracted from process_next_job for concurrency)
    async fn process_single_execution(
        db_pool: DatabasePool,
        machine_id: String,
        monitor_client: MonitorClient,
        retry_config: RetryConfig,
    ) -> Result<bool> {
        // Claim an execution
        let execution = WorkflowQueries::claim_execution(&db_pool, &machine_id).await?;

        let Some(execution) = execution else {
            return Ok(false); // No execution available
        };

        info!(
            "Claimed execution {} for workflow {} (retry {}/{})",
            execution.id,
            execution.workflow_id,
            execution.retry_count,
            execution.max_retries
        );

        // ... rest of your existing execution logic ...

        // AT THE END, when handling errors (line 302 in current code):
        Err(e) => {
            error!("Execution {} failed: {}", execution.id, e);

            let error_message = e.to_string();

            // Classify the error
            let error_category = classify_error(&error_message);

            info!(
                "Error classified as: {:?} for execution {}",
                error_category, execution.id
            );

            // Get logs from log_buffer
            let raw_logs = log_buffer.to_text();
            let execution_logs = log_buffer.to_json();

            // Determine if we should retry
            let should_retry = error_category == ErrorCategory::Infrastructure
                && retry_config.enabled
                && execution.retry_count < retry_config.max_infrastructure_retries as i32;

            if should_retry {
                // Schedule retry
                let retry_count = execution.retry_count + 1;
                let delay = retry_config.calculate_delay(retry_count as u32);
                let next_retry_at = Utc::now() + delay;

                info!(
                    "Scheduling retry {}/{} for execution {} at {} (delay: {}s)",
                    retry_count,
                    retry_config.max_infrastructure_retries,
                    execution.id,
                    next_retry_at,
                    delay.as_secs()
                );

                WorkflowQueries::schedule_retry(
                    &db_pool,
                    execution.id,
                    retry_count,
                    next_retry_at,
                    error_category,
                )
                .await?;

                // Notify monitor about scheduled retry
                monitor_client
                    .notify_execution_status(
                        execution.id,
                        workflow.id,
                        Some(workflow.name.clone()),
                        ExecutionStatus::Queued, // Status changed back to queued
                        Some(format!(
                            "Infrastructure failure. Retry {}/{} scheduled for {}",
                            retry_count, retry_config.max_infrastructure_retries, next_retry_at
                        )),
                        None,
                        Some(start_time),
                        Some(end_time),
                        Some(execution_time),
                        "rust_executor_retry_scheduled",
                    )
                    .await
                    .ok(); // Don't fail if notification fails
            } else {
                // Mark as permanently failed
                let reason = if error_category == ErrorCategory::Infrastructure {
                    format!(
                        "Max retries exceeded ({}/{})",
                        execution.retry_count, retry_config.max_infrastructure_retries
                    )
                } else {
                    "Workflow logic error (not retryable)".to_string()
                };

                info!(
                    "Marking execution {} as permanently failed: {}",
                    execution.id, reason
                );

                WorkflowQueries::mark_failed_permanently(
                    &db_pool,
                    execution.id,
                    &error_message,
                    error_category,
                )
                .await?;

                // Use existing error handling logic for logs
                let formatted_output = Some(format_exception(
                    &error_message,
                    execution_time as u64 * 1000,
                ));

                WorkflowQueries::update_execution_status_with_logs(
                    &db_pool,
                    execution.id,
                    ExecutionStatus::Failed,
                    Some(error_message.clone()),
                    None,
                    formatted_output,
                    Some(raw_logs),
                    Some(execution_logs),
                )
                .await?;

                // Notify monitor endpoint
                monitor_client
                    .notify_execution_status(
                        execution.id,
                        workflow.id,
                        Some(workflow.name.clone()),
                        ExecutionStatus::Failed,
                        Some(error_message),
                        None,
                        Some(start_time),
                        Some(end_time),
                        Some(execution_time),
                        "rust_executor_failed_permanently",
                    )
                    .await
                    .ok();
            }
        }

        Ok(true)
    }

    // Keep existing helper functions (generate_machine_id, etc.)
}
```

## Step 5: Update Environment Variables

**File:** `.env` or Azure Container Instance configuration

```bash
# Retry Configuration
RETRY_ENABLED=true
RETRY_MAX_INFRASTRUCTURE_RETRIES=3
RETRY_INITIAL_DELAY_SECS=30
RETRY_MAX_DELAY_SECS=600
RETRY_BACKOFF_MULTIPLIER=2.0

# Concurrency Configuration
MAX_CONCURRENT_EXECUTIONS=10
QUEUE_POLL_INTERVAL_SECS=5
```

**For Azure Container Instance:**
```bash
az container create \
  --resource-group mediar-workflow-executor-rg \
  --name workflow-executor-prod \
  --image ghcr.io/mediar-ai/rust-executor:latest \
  --cpu 1 \
  --memory 2 \
  --environment-variables \
    MAX_CONCURRENT_EXECUTIONS=10 \
    RETRY_ENABLED=true \
    RETRY_MAX_INFRASTRUCTURE_RETRIES=3 \
  --secrets \
    database-url=$DATABASE_URL \
    github-token=$GITHUB_TOKEN
```

## Step 6: Add Dependencies

**File:** `rust-executor/Cargo.toml`

Ensure you have:
```toml
[dependencies]
tokio = { version = "1", features = ["full", "sync"] }
```

## Step 7: Testing

### Test 1: Concurrent Execution

```bash
# Queue 20 workflows
for i in {1..20}; do
  curl -X POST http://localhost:8080/api/v1/workflows/123/execute \
    -H "Content-Type: application/json" \
    -d '{"inputs": {}}'
done

# Check executor logs - should show 10 concurrent executions
docker logs -f workflow-executor-dev

# Expected output:
# [INFO] Claimed execution 1 for workflow 123 (retry 0/3)
# [INFO] Claimed execution 2 for workflow 123 (retry 0/3)
# ...
# [INFO] Claimed execution 10 for workflow 123 (retry 0/3)
# [INFO] Successfully processed execution
# [INFO] Claimed execution 11 for workflow 123 (retry 0/3)
```

### Test 2: Infrastructure Retry

```bash
# 1. Stop MCP service on VM
ssh vm1 "sc stop mediar-mcp-agent"

# 2. Queue execution
curl -X POST http://localhost:8080/api/v1/workflows/123/execute

# 3. Check logs - should schedule retry
# [ERROR] Execution failed: Connection refused
# [INFO] Error classified as: Infrastructure
# [INFO] Scheduling retry 1/3 for execution at 2025-11-18 20:30:00

# 4. Wait 30 seconds, restart MCP
sleep 30
ssh vm1 "sc start mediar-mcp-agent"

# 5. Check logs - execution should succeed on retry
# [INFO] Claimed execution (retry 1/3)
# [INFO] Successfully processed execution
```

### Test 3: Workflow Logic Error (No Retry)

```bash
# Execute workflow that will have validation error
curl -X POST http://localhost:8080/api/v1/workflows/123/execute \
  -d '{"inputs": {"missing_required_field": null}}'

# Check logs - should NOT retry
# [ERROR] Execution failed: Validation failed: missing email
# [INFO] Error classified as: WorkflowLogic
# [INFO] Marking as permanently failed: Workflow logic error
```

## Step 8: Monitoring

Add monitoring endpoints to track concurrency:

**File:** `rust-executor/src/api/mod.rs`

```rust
#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(json!({
        "status": "healthy",
        "max_concurrent_executions": std::env::var("MAX_CONCURRENT_EXECUTIONS").unwrap_or("10".to_string()),
        "retry_enabled": std::env::var("RETRY_ENABLED").unwrap_or("true".to_string()),
    }))
}
```

## Rollout Plan

### Phase 1: Dev Environment (Week 1)
1. Apply database migration
2. Deploy with `MAX_CONCURRENT_EXECUTIONS=5` (conservative)
3. Monitor for 48 hours
4. Check CPU/memory usage
5. Increase to 10 if stable

### Phase 2: Staging (Week 2)
1. Deploy with `MAX_CONCURRENT_EXECUTIONS=10`
2. Test retry scenarios (VM maintenance)
3. Verify error classification
4. Monitor retry success rate

### Phase 3: Production (Week 3)
1. Deploy to prod with `MAX_CONCURRENT_EXECUTIONS=10`
2. Monitor queue length metrics
3. Scale horizontally if needed (add more ACIs)

## Expected Results

**Before:**
- Capacity: 1 execution per executor
- Queue processing: Slow
- Manual retries required

**After:**
- Capacity: 10-20 executions per executor
- Queue processing: 10x faster
- Automatic retry on infrastructure failures
- No retry on workflow logic errors

## Troubleshooting

### High Memory Usage
```bash
# Reduce concurrency
MAX_CONCURRENT_EXECUTIONS=5

# Or upgrade ACI memory
az container update --memory 4
```

### Retries Not Working
```bash
# Check database migration applied
psql -c "SELECT retry_count, is_retryable FROM workflow_executions LIMIT 5;"

# Check retry config
echo $RETRY_ENABLED
echo $RETRY_MAX_INFRASTRUCTURE_RETRIES
```

### Executions Stuck in Queue
```bash
# Check executor logs
docker logs workflow-executor-prod

# Check database
psql -c "SELECT id, status, retry_count, next_retry_at FROM workflow_executions WHERE status = 'queued';"
```

## Questions?

Check the documentation:
- `SCALING_ANALYSIS.md` - Capacity planning
- `RETRY_MECHANISM.md` - Error classification details
- `src/config/retry.rs` - Retry configuration

Good luck with the implementation! 🚀
