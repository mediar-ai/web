// OpenTelemetry support for Rust workflow executor
// Sends traces and logs to centralized OTLP collector (ClickHouse backend)

use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    propagation::TraceContextPropagator, runtime, trace::TracerProvider as SdkTracerProvider,
    Resource,
};
use opentelemetry_semantic_conventions::{
    attribute::{SERVICE_NAME, SERVICE_VERSION},
    SCHEMA_URL,
};
use std::time::Duration;
use tracing::info;

/// Initialize OpenTelemetry telemetry and logging
/// Returns true if successfully initialized, false if disabled/failed
pub fn init_telemetry() -> bool {
    // Check if telemetry is explicitly enabled
    let telemetry_enabled = std::env::var("OTEL_SDK_ENABLED")
        .unwrap_or_default()
        .eq_ignore_ascii_case("true");

    if !telemetry_enabled {
        info!("OpenTelemetry is disabled (set OTEL_SDK_ENABLED=true to enable)");
        return false;
    }

    // Check if telemetry is explicitly disabled
    if std::env::var("OTEL_SDK_DISABLED").unwrap_or_default() == "true" {
        info!("OpenTelemetry is disabled via OTEL_SDK_DISABLED");
        return false;
    }

    // Check if running in CI environment
    let is_ci = std::env::var("CI").unwrap_or_default() == "true"
        || std::env::var("GITHUB_ACTIONS").unwrap_or_default() == "true";

    if is_ci {
        info!("Running in CI environment, disabling OpenTelemetry");
        return false;
    }

    // Set up trace context propagator
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());

    // Configure OTLP exporter endpoint
    let otlp_endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4318".to_string());

    info!(
        "Initializing OpenTelemetry with endpoint: {}",
        otlp_endpoint
    );

    // Initialize telemetry in background thread to avoid blocking startup
    let endpoint_clone = otlp_endpoint.clone();
    std::thread::spawn(move || {
        if let Err(e) = init_telemetry_provider(&endpoint_clone) {
            tracing::error!("Failed to initialize OpenTelemetry provider: {}", e);
        }
    });

    true
}

/// Initialize the OpenTelemetry tracer provider
fn init_telemetry_provider(otlp_endpoint: &str) -> anyhow::Result<()> {
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

    // Create OTLP span exporter
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint(format!("{otlp_endpoint}/v1/traces"))
        .with_timeout(Duration::from_millis(500))
        .build()?;

    // Create tracer provider with batch exporter
    let provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter, runtime::Tokio)
        .with_resource(resource)
        .build();

    // Set global tracer provider
    opentelemetry::global::set_tracer_provider(provider);

    info!("OpenTelemetry tracer initialized successfully");
    Ok(())
}


/// Shutdown OpenTelemetry cleanly
#[allow(dead_code)]
pub fn shutdown_telemetry() {
    opentelemetry::global::shutdown_tracer_provider();
}
