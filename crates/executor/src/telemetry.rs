// OpenTelemetry support for Rust workflow executor
// Sends traces and logs to centralized OTLP collector (ClickHouse backend)

use opentelemetry::trace::TracerProvider; // Trait for .tracer() method
use opentelemetry::KeyValue;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    logs::LoggerProvider as SdkLoggerProvider, propagation::TraceContextPropagator, runtime,
    trace::TracerProvider as SdkTracerProvider, Resource,
};
use opentelemetry_semantic_conventions::{
    attribute::{SERVICE_NAME, SERVICE_VERSION},
    SCHEMA_URL,
};
use std::sync::OnceLock;
use std::time::Duration;
use tracing_subscriber::Layer;

// Global logger provider - must be kept alive for logs to work
static LOGGER_PROVIDER: OnceLock<SdkLoggerProvider> = OnceLock::new();

/// Initialize OpenTelemetry telemetry and logging
/// Returns Some(layer) if successfully initialized, None if disabled/failed
pub fn init_telemetry<S>() -> Option<impl Layer<S> + Send + Sync + 'static>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a> + Send + Sync,
{
    // Check if telemetry is explicitly enabled
    let telemetry_enabled = std::env::var("OTEL_SDK_ENABLED")
        .unwrap_or_default()
        .eq_ignore_ascii_case("true");

    if !telemetry_enabled {
        eprintln!("OpenTelemetry is disabled (set OTEL_SDK_ENABLED=true to enable)");
        return None;
    }

    // Check if telemetry is explicitly disabled
    if std::env::var("OTEL_SDK_DISABLED").unwrap_or_default() == "true" {
        eprintln!("OpenTelemetry is disabled via OTEL_SDK_DISABLED");
        return None;
    }

    // Check if running in CI environment
    let is_ci = std::env::var("CI").unwrap_or_default() == "true"
        || std::env::var("GITHUB_ACTIONS").unwrap_or_default() == "true";

    if is_ci {
        eprintln!("Running in CI environment, disabling OpenTelemetry");
        return None;
    }

    // Set up trace context propagator
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());

    // Configure OTLP exporter endpoint
    let otlp_endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4318".to_string());

    eprintln!(
        "Initializing OpenTelemetry with endpoint: {}",
        otlp_endpoint
    );

    // Initialize telemetry provider and get the layer
    match init_telemetry_provider(&otlp_endpoint) {
        Ok(layer) => {
            eprintln!("✓ OpenTelemetry layer initialized (traces + logs)");
            Some(layer)
        }
        Err(e) => {
            eprintln!("✗ Failed to initialize OpenTelemetry provider: {}", e);
            None
        }
    }
}

/// Initialize the OpenTelemetry tracer and log provider
/// Returns a combined layer that handles both traces and logs
fn init_telemetry_provider<S>(
    otlp_endpoint: &str,
) -> anyhow::Result<impl Layer<S> + Send + Sync + 'static>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a> + Send + Sync,
{
    // Create resource with service identification
    let mut resource_kvs = vec![
        KeyValue::new(SERVICE_NAME, "mediar-workflow-executor-rust"),
        KeyValue::new(SERVICE_VERSION, env!("CARGO_PKG_VERSION")),
    ];

    // Add deployment environment
    if let Ok(env) = std::env::var("ENVIRONMENT") {
        resource_kvs.push(KeyValue::new("deployment.environment", env));
    }

    // Add hostname for segmentation in ClickHouse
    if let Ok(hostname) = hostname::get() {
        if let Some(hostname_str) = hostname.to_str() {
            resource_kvs.push(KeyValue::new("host.name", hostname_str.to_string()));
        }
    }

    // Add Azure container instance info if available
    if let Ok(container_name) = std::env::var("AZURE_CONTAINER_NAME") {
        resource_kvs.push(KeyValue::new("container.name", container_name));
    }
    if let Ok(resource_group) = std::env::var("AZURE_RESOURCE_GROUP") {
        resource_kvs.push(KeyValue::new("azure.resource_group", resource_group));
    }

    let resource = Resource::from_schema_url(resource_kvs, SCHEMA_URL);

    // Create OTLP span exporter for traces
    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint(format!("{otlp_endpoint}/v1/traces"))
        .with_timeout(Duration::from_millis(500))
        .build()?;

    // Create tracer provider with batch exporter
    // Use AlwaysOn sampler to ensure all spans are recorded
    use opentelemetry_sdk::trace::Sampler;
    let trace_provider = SdkTracerProvider::builder()
        .with_batch_exporter(trace_exporter, runtime::Tokio)
        .with_resource(resource.clone())
        .with_sampler(Sampler::AlwaysOn)
        .build();

    // Get tracer BEFORE setting as global (so we have the concrete type)
    let tracer = trace_provider.tracer("mediar-workflow-executor-rust");

    // Set global tracer provider
    opentelemetry::global::set_tracer_provider(trace_provider);

    // Create OTLP log exporter for logs
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_endpoint(format!("{otlp_endpoint}/v1/logs"))
        .with_timeout(Duration::from_millis(500))
        .build()?;

    // Create logger provider with batch exporter
    // IMPORTANT: Store this in a static OnceLock so it doesn't get dropped!
    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter, runtime::Tokio)
        .with_resource(resource)
        .build();

    // Store the logger provider in a global static to keep it alive
    let provider_ref = LOGGER_PROVIDER.get_or_init(|| logger_provider);

    eprintln!("✓ OpenTelemetry tracer and logger providers created");
    eprintln!("  Logs will be sent to: {}/v1/logs", otlp_endpoint);
    eprintln!("  Traces will be sent to: {}/v1/traces", otlp_endpoint);

    // Create the tracing-opentelemetry layer for traces
    // The tracer was created above before setting the provider as global
    let traces_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    // Create the OpenTelemetryTracingBridge layer for logs
    // This bridges tracing events (info!, error!, etc.) to OpenTelemetry logs
    let logs_layer = OpenTelemetryTracingBridge::new(provider_ref);

    // Combine both layers using .and_then()
    let combined_layer = traces_layer.and_then(logs_layer);

    Ok(combined_layer)
}

/// Shutdown OpenTelemetry cleanly
#[allow(dead_code)]
pub fn shutdown_telemetry() {
    opentelemetry::global::shutdown_tracer_provider();
    // Also shutdown logger provider if it exists
    if let Some(provider) = LOGGER_PROVIDER.get() {
        let _ = provider.shutdown();
    }
}

/// Get the current trace ID as a hex string
/// Returns None if not currently in a span or if telemetry is disabled
pub fn current_trace_id() -> Option<String> {
    use opentelemetry::trace::TraceContextExt;
    use tracing::Span;
    use tracing_opentelemetry::OpenTelemetrySpanExt;

    let span = Span::current();
    let context = span.context();
    let span_ref = context.span();
    let span_context = span_ref.span_context();

    if span_context.is_valid() {
        Some(span_context.trace_id().to_string())
    } else {
        None
    }
}

/// Record a structured attribute on the current span
#[allow(dead_code)]
pub fn record_span_attribute(key: &str, value: impl Into<String>) {
    use tracing::Span;
    let span = Span::current();
    span.record(key, value.into());
}
