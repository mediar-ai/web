// Test program to verify OpenTelemetry trace_id generation
// Run with: cargo run --bin test_otel

use tracing::{info, info_span};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    // Initialize tracing with console output
    let console_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_line_number(true);

    // Initialize OpenTelemetry (if enabled)
    let otel_layer = workflow_executor::telemetry::init_telemetry();

    if let Some(otel_layer) = otel_layer {
        tracing_subscriber::registry()
            .with(console_layer)
            .with(otel_layer)
            .init();
        println!("✓ OpenTelemetry layer initialized");
    } else {
        tracing_subscriber::registry()
            .with(console_layer)
            .init();
        println!("✗ OpenTelemetry layer NOT initialized (disabled or failed)");
    }

    // Create a span and check if we get a trace_id
    let test_span = info_span!(
        "test_execution",
        execution_id = 99999,
        workflow_id = 12345
    );

    let _enter = test_span.enter();

    // Debug: Check span context details
    use opentelemetry::trace::TraceContextExt;
    use tracing::Span;
    use tracing_opentelemetry::OpenTelemetrySpanExt;

    let span = Span::current();
    let context = span.context();
    let span_ref = context.span();
    let span_context = span_ref.span_context();

    println!("\n=== OTEL Span Context Debug ===");
    println!("span_context.is_valid(): {}", span_context.is_valid());
    println!("span_context.trace_id(): {}", span_context.trace_id());
    println!("span_context.span_id(): {}", span_context.span_id());
    println!("span_context.is_remote(): {}", span_context.is_remote());
    println!("================================\n");

    // Try to get trace_id from OpenTelemetry
    if let Some(trace_id) = workflow_executor::telemetry::current_trace_id() {
        info!(trace_id = %trace_id, "✓ Got trace_id from OpenTelemetry");
        println!("\n✓ SUCCESS: trace_id = {}", trace_id);
    } else {
        info!("✗ No trace_id available from OpenTelemetry");
        println!("\n✗ FAILED: No trace_id available");

        // Try manual generation as fallback
        use opentelemetry::trace::TraceId;
        let manual_trace_id = TraceId::from_bytes(rand::random());
        info!(trace_id = %manual_trace_id, "Generated manual trace_id as fallback");
        println!("✓ Manual fallback: trace_id = {}", manual_trace_id);
    }

    drop(_enter);

    // Give time for logs to flush
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    println!("\nTest complete!");
}
