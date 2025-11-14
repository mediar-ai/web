# Sentry Integration

The Rust Executor now includes comprehensive Sentry integration for error tracking, performance monitoring, and tracing.

## Features

### 1. **Error Tracking**
- Automatic capture of panics and errors
- Stack traces with source code context
- Breadcrumbs from tracing events

### 2. **Performance Monitoring**
- HTTP request transaction tracking (10% sample rate)
- Database query spans
- Custom spans from `tracing` instrumentation

### 3. **Tracing Integration**
- All `tracing` events (info, warn, error) are sent to Sentry as breadcrumbs
- Error-level logs create Sentry events
- Automatic correlation between traces and errors

## Configuration

### Environment Variables

```bash
# Required: Your Sentry DSN from https://sentry.io
SENTRY_DSN=https://your-key@sentry.io/your-project-id

# Optional: Environment tag (default: production)
ENVIRONMENT=staging  # or development, production

# Optional: Enable Sentry debug mode
SENTRY_DEBUG=1
```

### Sample Rates

- **Error Events**: 100% (all errors are captured)
- **Performance Transactions**: 10% (configurable in `main.rs`)

## Usage

### Automatic Tracking

Most errors are automatically captured through:

1. **HTTP Middleware**: All requests are tracked as transactions
2. **Tracing Integration**: Error logs automatically create Sentry events
3. **Panic Handler**: Panics are captured with full stack traces

### Manual Error Capture

```rust
use tracing::error;

// This will automatically create a Sentry event
error!("Database connection failed: {}", err);

// Or use Sentry directly for more control
sentry::capture_message("Custom event", sentry::Level::Warning);
```

### Adding Context

```rust
use tracing::{info, error};

// Breadcrumbs help debug errors
info!("Processing workflow {}", workflow_id);
info!("Fetching data from database");

// If an error occurs, these breadcrumbs will be attached
error!("Workflow execution failed: {}", err);
```

### Performance Tracking

Custom spans are automatically tracked:

```rust
use tracing::instrument;

#[instrument(skip(db))]
async fn process_workflow(db: &Database, workflow_id: i32) -> Result<()> {
    // This function's execution time will be tracked
    // All tracing events inside will be breadcrumbs
    info!("Starting workflow processing");
    // ...
}
```

## What Gets Sent to Sentry

### Every Request
- HTTP method, path, status code
- Response time (if sampled)
- User-agent, IP address

### Every Error
- Error message and stack trace
- Source code context (filename, line number)
- Environment (production, staging, etc.)
- Release version (from Cargo.toml)
- All breadcrumbs (recent log events)

### Performance Samples (10%)
- Request duration
- Database query times
- Custom span timings

## Privacy & Security

- **No sensitive data**: Sentry integration does NOT capture request bodies or sensitive headers
- **Stacktrace scrubbing**: Enabled by default
- **Sample rate**: Only 10% of transactions sent for performance monitoring
- **Opt-out**: Simply don't set `SENTRY_DSN` to disable Sentry

## Testing

### Local Testing

```bash
# Set your Sentry DSN
export SENTRY_DSN="https://your-key@sentry.io/your-project"
export ENVIRONMENT="development"

# Run the executor
cargo run

# Trigger an error to test
curl http://localhost:8080/api/v1/invalid-endpoint
```

Check Sentry dashboard for the error event.

### Debug Mode

```bash
# Enable Sentry debug output
export SENTRY_DEBUG=1
cargo run
```

This will print all Sentry events to stderr.

## Monitoring in Production

### Key Metrics to Watch

1. **Error Rate**: Track errors per minute
2. **Response Times**: P50, P95, P99 percentiles  
3. **Database Performance**: Query timing distribution
4. **Release Comparison**: Compare error rates between deployments

### Alerts

Set up Sentry alerts for:
- Error spike (>10 errors/minute)
- New error types
- Performance degradation (P95 > 2s)
- High error rate on specific endpoints

## Integration with Existing Tracing

The Sentry integration is built on top of `tracing`, so all existing instrumentation works automatically:

```rust
// Existing code - no changes needed
#[instrument]
async fn execute_workflow(workflow_id: i32) -> Result<()> {
    info!("Starting execution");
    
    match do_work().await {
        Ok(_) => info!("Success"),
        Err(e) => {
            error!("Failed: {}", e);  // Automatically sent to Sentry
            return Err(e);
        }
    }
    
    Ok(())
}
```

## Cost Optimization

Current configuration:
- **10% transaction sampling**: ~90% cost reduction for performance monitoring
- **Smart filtering**: Only errors and warnings create events
- **Breadcrumb limits**: Last 100 breadcrumbs per error

To reduce costs further:
- Lower `traces_sample_rate` in `main.rs`
- Add environment-based filtering (skip Sentry in dev)
- Use Sentry's rate limiting features

## Troubleshooting

### Sentry Not Receiving Events

1. Check DSN is correct: `echo $SENTRY_DSN`
2. Enable debug mode: `export SENTRY_DEBUG=1`
3. Verify network connectivity to sentry.io
4. Check Sentry project is active

### Too Many Events

1. Lower sample rate in `main.rs`
2. Add filters to ignore specific errors
3. Use Sentry's spike protection

### Missing Context

1. Add more `info!()` breadcrumbs
2. Use `#[instrument]` on key functions
3. Add custom tags/context to errors

## Resources

- [Sentry Rust SDK Docs](https://docs.sentry.io/platforms/rust/)
- [Tracing Integration](https://docs.sentry.io/platforms/rust/guides/tracing/)
- [Performance Monitoring](https://docs.sentry.io/platforms/rust/performance/)
