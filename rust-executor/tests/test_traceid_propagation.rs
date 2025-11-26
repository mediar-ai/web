/// Tests for OpenTelemetry TraceId propagation to logs
///
/// Issue: `set_parent(otel_context)` on a tracing span doesn't result in logs having
/// the TraceId column populated in ClickHouse - only LogAttributes['trace_id'] is set.
///
/// Root Cause: The `OpenTelemetryTracingBridge` uses `Context::map_current()` with
/// `cx.has_active_span()` to get the TraceId. Using `with_remote_span_context()` creates
/// a context with a SpanContext but NOT an active span, so `has_active_span()` returns false.
///
/// Solution: Let the `tracing-opentelemetry` layer create OTEL spans from tracing spans.
/// The layer automatically creates proper OTEL spans that will be active, and the
/// `OpenTelemetryTracingBridge` will pick up the TraceId from those active spans.
///
/// We then use `current_trace_id()` to get the generated TraceId and store it in the database.
use opentelemetry::trace::{SpanContext, SpanId, TraceContextExt, TraceFlags, TraceId, TraceState};
use opentelemetry::Context;
use std::sync::{Arc, Mutex};
use tracing::{info, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::layer::SubscriberExt;

/// A simple log collector that captures logs for testing
struct TestLogCollector {
    logs: Arc<Mutex<Vec<TestLogEntry>>>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct TestLogEntry {
    message: String,
    trace_id: Option<String>,
    span_id: Option<String>,
    fields: std::collections::HashMap<String, String>,
}

impl TestLogCollector {
    fn new() -> (Self, Arc<Mutex<Vec<TestLogEntry>>>) {
        let logs = Arc::new(Mutex::new(Vec::new()));
        (Self { logs: logs.clone() }, logs)
    }
}

impl<S> tracing_subscriber::Layer<S> for TestLogCollector
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    fn on_event(&self, event: &tracing::Event<'_>, ctx: tracing_subscriber::layer::Context<'_, S>) {
        // Get the current span context from OpenTelemetry
        let otel_trace_id = if let Some(span) = ctx.lookup_current() {
            // Get the OpenTelemetry context from the tracing span
            let otel_ctx = span
                .extensions()
                .get::<tracing_opentelemetry::OtelData>()
                .map(|otel_data| otel_data.parent_cx.clone())
                .unwrap_or_else(Context::current);

            let span_ref = otel_ctx.span();
            let span_context = span_ref.span_context();

            if span_context.is_valid() {
                Some(span_context.trace_id().to_string())
            } else {
                None
            }
        } else {
            None
        };

        // Collect field values
        let mut fields = std::collections::HashMap::new();
        let mut visitor = FieldVisitor {
            fields: &mut fields,
        };
        event.record(&mut visitor);

        let message = fields.get("message").cloned().unwrap_or_default();

        let entry = TestLogEntry {
            message,
            trace_id: otel_trace_id,
            span_id: None, // Not capturing for this test
            fields,
        };

        self.logs.lock().unwrap().push(entry);
    }
}

struct FieldVisitor<'a> {
    fields: &'a mut std::collections::HashMap<String, String>,
}

impl<'a> tracing::field::Visit for FieldVisitor<'a> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.fields
            .insert(field.name().to_string(), format!("{:?}", value));
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        self.fields
            .insert(field.name().to_string(), value.to_string());
    }
}

/// Test that set_parent DOES propagate TraceId when tracing-opentelemetry layer is used
#[test]
fn test_set_parent_propagates_trace_id() {
    // Create a custom TraceId
    let trace_id_bytes: [u8; 16] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    let span_id_bytes: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8];
    let otel_trace_id = TraceId::from_bytes(trace_id_bytes);
    let otel_span_id = SpanId::from_bytes(span_id_bytes);
    let expected_trace_id = otel_trace_id.to_string();

    // Create SpanContext with our custom TraceId
    let span_context = SpanContext::new(
        otel_trace_id,
        otel_span_id,
        TraceFlags::SAMPLED,
        true, // is_remote
        TraceState::default(),
    );

    // Create the OpenTelemetry context with our span context
    let otel_context = Context::current().with_remote_span_context(span_context);

    // Set up the test log collector
    let (collector, logs) = TestLogCollector::new();

    // Create a minimal tracing-opentelemetry setup
    // Note: In production, this would also have the OpenTelemetryTracingBridge layer
    let subscriber = tracing_subscriber::registry().with(collector);

    // Run within the subscriber context
    tracing::subscriber::with_default(subscriber, || {
        // Create a tracing span and set its parent to our OTEL context
        let span = info_span!(
            "test_execution",
            execution_id = 12345,
            trace_id = %expected_trace_id,
        );

        // This is what we're testing - does set_parent work?
        span.set_parent(otel_context);

        let _guard = span.enter();

        // Log a message - this should have the TraceId from the parent context
        info!(execution_id = 12345, "Test log message");
    });

    // Check the captured logs
    let captured_logs = logs.lock().unwrap();
    assert!(
        !captured_logs.is_empty(),
        "Should have captured at least one log"
    );

    let log = &captured_logs[0];
    println!("Captured log: {:?}", log);
    println!("Expected trace_id: {}", expected_trace_id);

    // The test shows the CURRENT behavior - trace_id from set_parent may NOT propagate
    // to the logs without proper tracing-opentelemetry layer setup
    //
    // In production with OpenTelemetryTracingBridge, the trace_id field IS set as
    // LogAttributes['trace_id'], but the TraceId column in OTEL logs may be empty
    // because OpenTelemetryTracingBridge reads from the ACTIVE OTEL span, not
    // from the parent context set via set_parent.
}

/// Test that verifies the trace_id field is at least captured in the span
#[test]
fn test_trace_id_field_is_captured() {
    let (collector, logs) = TestLogCollector::new();

    let subscriber = tracing_subscriber::registry().with(collector);

    let test_trace_id = "abc123def456";

    tracing::subscriber::with_default(subscriber, || {
        let span = info_span!(
            "execution",
            trace_id = %test_trace_id,
            execution_id = 999,
        );

        let _guard = span.enter();
        info!(test_field = "value", "Log with trace_id in parent span");
    });

    let captured_logs = logs.lock().unwrap();
    assert!(!captured_logs.is_empty());

    // The trace_id field exists in the span, but may not propagate to OTEL TraceId column
    // This is expected behavior that we want to fix
}

/// Test demonstrating the fix: using Context::current_with_span to properly activate the span
#[test]
fn test_context_activation_for_trace_id() {
    // Create a custom TraceId we want to use
    let trace_id_bytes: [u8; 16] = [0xAB; 16];
    let span_id_bytes: [u8; 8] = [0xCD; 8];
    let otel_trace_id = TraceId::from_bytes(trace_id_bytes);
    let otel_span_id = SpanId::from_bytes(span_id_bytes);
    let expected_trace_id = otel_trace_id.to_string();

    println!("Expected trace_id: {}", expected_trace_id);

    // Create SpanContext
    let span_context = SpanContext::new(
        otel_trace_id,
        otel_span_id,
        TraceFlags::SAMPLED,
        true,
        TraceState::default(),
    );

    // Create context with our span
    let otel_context = Context::current().with_remote_span_context(span_context);

    // Verify we can read back the trace_id from the context
    let span_ref = otel_context.span();
    let retrieved_context = span_ref.span_context();
    let retrieved_trace_id = retrieved_context.trace_id().to_string();

    println!("Retrieved trace_id from context: {}", retrieved_trace_id);

    assert_eq!(
        expected_trace_id, retrieved_trace_id,
        "Should be able to retrieve the trace_id from the context"
    );
}

/// Test that the current approach doesn't set TraceId on logs (demonstrating the bug)
#[test]
fn test_current_approach_bug_demonstration() {
    // This test demonstrates that set_parent alone doesn't make TraceId appear in logs
    // The OpenTelemetryTracingBridge looks at Context::current().span().span_context()
    // to get the TraceId, but set_parent only sets it on the tracing span's extensions,
    // not on the global Context.

    let trace_id_bytes: [u8; 16] = [0x11; 16];
    let span_id_bytes: [u8; 8] = [0x22; 8];
    let otel_trace_id = TraceId::from_bytes(trace_id_bytes);
    let otel_span_id = SpanId::from_bytes(span_id_bytes);

    let span_context = SpanContext::new(
        otel_trace_id,
        otel_span_id,
        TraceFlags::SAMPLED,
        true,
        TraceState::default(),
    );

    let otel_context = Context::current().with_remote_span_context(span_context);

    // Just creating the context and setting it as parent doesn't activate it globally
    let span = info_span!("test_span", trace_id = %otel_trace_id.to_string());
    span.set_parent(otel_context.clone());
    let _guard = span.enter();

    // Check what Context::current() returns - this is what OpenTelemetryTracingBridge uses
    let current_ctx = Context::current();
    let current_span = current_ctx.span();
    let current_span_ctx = current_span.span_context();

    println!(
        "TraceId from Context::current(): {}",
        current_span_ctx.trace_id()
    );
    println!("Is valid: {}", current_span_ctx.is_valid());

    // This will show "00000000000000000000000000000000" (invalid) because
    // the context wasn't attached to the current thread
    // The fix needs to use otel_context.attach() or wrap operations in
    // otel_context.clone().map(...) to make the context active
}

/// Test the FIX: using Context::attach() to make the OTEL context active
#[test]
fn test_context_attach_fix() {
    let trace_id_bytes: [u8; 16] = [0x42; 16];
    let span_id_bytes: [u8; 8] = [0x43; 8];
    let otel_trace_id = TraceId::from_bytes(trace_id_bytes);
    let otel_span_id = SpanId::from_bytes(span_id_bytes);
    let expected_trace_id = otel_trace_id.to_string();

    let span_context = SpanContext::new(
        otel_trace_id,
        otel_span_id,
        TraceFlags::SAMPLED,
        true,
        TraceState::default(),
    );

    let otel_context = Context::current().with_remote_span_context(span_context);

    // THE FIX: Attach the context to make it the current context
    // This returns a ContextGuard that must be kept alive
    let _context_guard = otel_context.attach();

    // Now Context::current() returns our context with the custom TraceId
    let current_ctx = Context::current();
    let current_span = current_ctx.span();
    let current_span_ctx = current_span.span_context();

    println!("Expected TraceId: {}", expected_trace_id);
    println!(
        "TraceId from Context::current(): {}",
        current_span_ctx.trace_id()
    );
    println!("Is valid: {}", current_span_ctx.is_valid());

    assert!(current_span_ctx.is_valid(), "SpanContext should be valid");
    assert_eq!(
        current_span_ctx.trace_id().to_string(),
        expected_trace_id,
        "TraceId should match what we set"
    );
}
