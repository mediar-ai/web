# Rust Executor Scaling & Concurrency Analysis

## Current Architecture

### ✅ Horizontal Scaling: SUPPORTED

The rust-executor **already supports horizontal scaling**:

```rust
// Each instance gets a unique ID
let machine_id = format!("{}-{}", hostname, Uuid::new_v4());

// PostgreSQL's SKIP LOCKED prevents conflicts
SELECT id FROM workflow_executions
WHERE status = 'queued'
ORDER BY priority DESC, queued_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

**This means:**
- ✅ You can run **unlimited executor instances** in parallel
- ✅ No conflicts - each instance claims different executions
- ✅ Each instance independently polls the queue

### ❌ Concurrent Execution per Instance: NOT SUPPORTED

**Current behavior** (queue_processor.rs:41-54):
```rust
loop {
    ticker.tick().await;  // Wait 5 seconds

    match self.process_next_job().await {
        // Process ONE execution at a time
        // Next execution only starts after this one completes
    }
}
```

**Capacity:**
- **Per executor instance**: 1 execution at a time
- **Horizontal scaling**: Deploy N containers → N concurrent executions total
- **Efficiency**: POOR (CPU mostly idle during I/O-bound workflow steps)

## Current Capacity Calculation

### Scenario: Single Azure Container Instance (ACI)

**Container specs:**
- 1 CPU core
- 1 GB memory
- 1 rust-executor process

**Current capacity:**
```
Concurrent executions = 1 (single-threaded loop)
Queue processing rate = 1 execution every ~5-30 seconds (depends on workflow)
```

**If you deploy 3 ACIs:**
```
Concurrent executions = 3
Total capacity = 3 executors × 1 concurrent = 3 executions at once
```

### Problem: Waste of Resources

Workflow executions are **mostly I/O-bound**:
- Waiting for MCP server response
- Waiting for Windows automation steps
- Waiting for network requests

**CPU usage during execution: ~5-20%**

This means **80-95% of CPU is idle** while waiting for I/O!

## Proposed Solution: Concurrent Execution

### Architecture: Tokio Task Pool

```rust
pub struct QueueProcessor {
    db_pool: DatabasePool,
    machine_id: String,
    monitor_client: MonitorClient,
    max_concurrent_executions: usize,  // NEW: Configurable concurrency
}

impl QueueProcessor {
    pub async fn start(&self) -> Result<()> {
        let semaphore = Arc::new(Semaphore::new(self.max_concurrent_executions));
        let mut ticker = interval(Duration::from_secs(5));

        loop {
            ticker.tick().await;

            // Try to claim and spawn a new execution if we have capacity
            if semaphore.available_permits() > 0 {
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let db_pool = self.db_pool.clone();
                let machine_id = self.machine_id.clone();
                let monitor_client = self.monitor_client.clone();

                tokio::spawn(async move {
                    // Process execution concurrently
                    if let Err(e) = process_execution(db_pool, machine_id, monitor_client).await {
                        error!("Execution failed: {}", e);
                    }
                    // Permit automatically released when dropped
                    drop(permit);
                });
            }
        }
    }
}
```

### New Capacity with Concurrency

**Single ACI with max_concurrent_executions = 10:**
```
Concurrent executions = 10 (instead of 1)
CPU usage = ~20-40% (better utilization)
Memory usage = ~200-500 MB (still within 1 GB limit)
```

**3 ACIs with max_concurrent_executions = 10 each:**
```
Total concurrent executions = 30 (instead of 3)
Total capacity = 10x improvement!
```

### Configuration via Environment Variables

```bash
# Azure Container Instance environment
MAX_CONCURRENT_EXECUTIONS=10    # How many executions to run at once
QUEUE_POLL_INTERVAL_SECS=5      # How often to check queue
```

## Resource Requirements

### Memory per Execution

**Typical workflow execution:**
- Rust executor overhead: ~10 MB
- MCP client: ~5 MB
- Log buffer: ~2-5 MB
- Workflow state: ~1-3 MB
- **Total: ~20-25 MB per concurrent execution**

**Container sizing:**
```
1 GB RAM = ~40 concurrent executions (theoretical max)
2 GB RAM = ~80 concurrent executions
```

**Recommended configuration:**
- 1 GB RAM → max_concurrent_executions = 10-15 (safe)
- 2 GB RAM → max_concurrent_executions = 30-40 (optimal)
- 4 GB RAM → max_concurrent_executions = 80-100 (high-throughput)

### CPU Requirements

**Workflow execution is I/O-bound:**
- 1 CPU core can easily handle 10-20 concurrent executions
- 2 CPU cores can handle 30-50 concurrent executions

**Recommended:**
- Start with: 1 CPU core + 10 concurrent executions
- Scale up if CPU usage consistently > 70%

## Scaling Strategies

### Vertical Scaling (Increase per-instance capacity)

**When to use:**
- Queue is consistently backed up
- CPU/memory usage is low (< 50%)
- Cost-effective (cheaper than more instances)

**How:**
```bash
# Update Azure Container Instance
MAX_CONCURRENT_EXECUTIONS=20  # Increase from 10 to 20
```

### Horizontal Scaling (Add more instances)

**When to use:**
- Single instance at capacity (CPU > 70%, memory > 80%)
- Need redundancy/high availability
- Geographic distribution

**How:**
```bash
# Deploy more ACIs
az container create --name workflow-executor-prod-2 ...
az container create --name workflow-executor-prod-3 ...
```

**Auto-scaling (Azure Container Apps):**
```yaml
resources:
  cpu: 1
  memory: 2Gi
scale:
  minReplicas: 2
  maxReplicas: 10
  rules:
    - name: queue-length
      custom:
        type: postgresql
        metadata:
          query: |
            SELECT COUNT(*) FROM workflow_executions
            WHERE status = 'queued'
          targetQueryValue: "50"  # Scale up if > 50 queued
```

## Performance Comparison

### Current Architecture (Sequential)

```
Scenario: 100 workflows queued, average execution time 30 seconds

Single executor:
- Concurrent executions: 1
- Time to complete: 100 × 30s = 3,000 seconds (50 minutes)
- Throughput: 2 executions/minute

3 executors:
- Concurrent executions: 3
- Time to complete: 100 × 30s / 3 = 1,000 seconds (16.7 minutes)
- Throughput: 6 executions/minute
```

### Proposed Architecture (Concurrent)

```
Scenario: 100 workflows queued, average execution time 30 seconds

Single executor (max_concurrent = 10):
- Concurrent executions: 10
- Time to complete: 100 × 30s / 10 = 300 seconds (5 minutes)
- Throughput: 20 executions/minute

3 executors (max_concurrent = 10 each):
- Concurrent executions: 30
- Time to complete: 100 × 30s / 30 = 100 seconds (1.7 minutes)
- Throughput: 60 executions/minute
```

**Improvement: 10x faster** with same infrastructure cost!

## Implementation Checklist

### Phase 1: Add Concurrent Execution (HIGH PRIORITY)

- [ ] Add `max_concurrent_executions` config to `QueueProcessor`
- [ ] Replace single-threaded loop with Tokio task pool
- [ ] Add semaphore for concurrency control
- [ ] Test with 10 concurrent executions
- [ ] Monitor CPU/memory usage
- [ ] Tune configuration based on real-world data

### Phase 2: Add Retry Mechanism (HIGH PRIORITY)

- [ ] Database migration (add retry columns)
- [ ] Implement error classification in queue processor
- [ ] Add retry scheduling logic
- [ ] Update `claim_execution` to include retryable executions
- [ ] Test VM maintenance scenarios

### Phase 3: Advanced Scaling

- [ ] Migrate to Azure Container Apps (auto-scaling)
- [ ] Add queue-based scaling rules
- [ ] Implement circuit breaker for failing workflows
- [ ] Add execution priority queues
- [ ] Health check endpoint for ACI

## Cost Analysis

### Current: Single ACI (Sequential)

```
Azure Container Instance (1 CPU, 1 GB RAM):
- Cost: ~$0.0000133/second = ~$34/month
- Capacity: 1 concurrent execution
- Throughput: ~2 executions/minute
- Cost per 1000 executions: ~$2.83 (assumes 30s avg)
```

### Proposed: Single ACI (Concurrent)

```
Azure Container Instance (1 CPU, 2 GB RAM):
- Cost: ~$0.0000166/second = ~$42/month
- Capacity: 10 concurrent executions
- Throughput: ~20 executions/minute
- Cost per 1000 executions: ~$0.35 (assumes 30s avg)

Savings: 8x cheaper per execution!
```

### Proposed: 3 ACIs (Concurrent + Horizontal)

```
3× Azure Container Instance (1 CPU, 2 GB RAM each):
- Cost: ~$126/month total
- Capacity: 30 concurrent executions
- Throughput: ~60 executions/minute
- High availability (redundancy)
- Cost per 1000 executions: ~$0.35

vs. 30 sequential executors: ~$1,020/month
Savings: ~$900/month!
```

## Monitoring & Observability

### Key Metrics to Track

```rust
// Add to monitoring endpoint
{
  "executor_id": "hostname-uuid",
  "max_concurrent_executions": 10,
  "current_concurrent_executions": 7,
  "available_capacity": 3,
  "total_executions_processed": 1234,
  "avg_execution_time_secs": 28.5,
  "cpu_usage_percent": 35.2,
  "memory_usage_mb": 450
}
```

### Alerts to Configure

- CPU usage > 80% for 5 minutes → Scale up vertically
- Queue length > 100 for 10 minutes → Scale up horizontally
- Failed executions > 10% → Investigate
- Retry rate > 30% → Check infrastructure health

## Recommendations

### Immediate Actions

1. **Implement concurrent execution** (biggest impact, low effort)
   - Set `max_concurrent_executions = 10` initially
   - Deploy to dev environment first
   - Monitor for 24-48 hours
   - Gradually increase if stable

2. **Implement retry mechanism** (improve reliability)
   - Add database columns
   - Deploy with concurrent execution
   - Test VM maintenance scenarios

3. **Monitor performance**
   - Track queue length
   - Track CPU/memory usage
   - Measure execution throughput

### Long-term Strategy

1. **Month 1-2**: Run with concurrent execution, tune config
2. **Month 3**: Migrate to Azure Container Apps for auto-scaling
3. **Month 4+**: Add advanced features (circuit breaker, priority queues)

### Capacity Planning

**For 1000 workflow executions/day:**
- Average execution time: 30 seconds
- Total compute time: 30,000 seconds/day = 8.33 hours/day
- **Required capacity:**
  - Sequential (1 concurrent): Need 8.33/24 = ~1 executor running 24/7
  - Concurrent (10 concurrent): Need 0.83/24 = ~1 executor with spare capacity
  - **Recommendation**: 1 ACI with max_concurrent = 10

**For 10,000 workflow executions/day:**
- Total compute time: 300,000 seconds/day = 83.3 hours/day
- **Required capacity:**
  - Concurrent (10 concurrent): Need 83.3/24 = ~3.5 executors
  - **Recommendation**: 3-4 ACIs with max_concurrent = 10 each
  - Or: 2 ACIs with max_concurrent = 20 each

## Next Steps

Ready to implement? Here's the plan:

1. I'll create the concurrent execution code
2. I'll create the database migration for retry mechanism
3. I'll update the queue processor with both features
4. You test in dev environment
5. We tune configuration based on real-world metrics
6. Deploy to production

Sound good?
