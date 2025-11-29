use anyhow::{Context, Result};
use axum::{extract::DefaultBodyLimit, Router};
use clap::{Parser, Subcommand};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info};

mod api;
mod config;
mod db;
mod mcp;
mod models;
mod services;
mod telemetry;
mod utils;
mod workflow_downloader;

use crate::api::AppState;
use crate::db::create_pool;
use crate::models::ExecutionRequest;
use crate::services::{CancellationRegistry, QueueProcessor};

#[derive(Parser)]
#[command(name = "workflow-executor")]
#[command(about = "Mediar Workflow Executor - Run workflows on remote machines", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the API server and queue processor
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "8080")]
        port: u16,
    },
    /// Run a specific workflow on a machine
    Run {
        /// Machine name or ID (e.g., vm1, vm2, or MCP endpoint URL)
        machine: String,
        /// Workflow name or ID
        workflow: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing (with Sentry and OpenTelemetry)
    init_tracing();

    // Parse CLI arguments
    let cli = Cli::parse();

    match cli.command {
        None | Some(Commands::Serve { .. }) => {
            // Default behavior: start server (for backward compatibility)
            let port = if let Some(Commands::Serve { port }) = cli.command {
                port
            } else {
                std::env::var("PORT")
                    .unwrap_or_else(|_| "8080".to_string())
                    .parse::<u16>()?
            };

            start_server(port).await
        }
        Some(Commands::Run { machine, workflow }) => run_workflow_directly(machine, workflow).await,
    }
}

async fn start_server(port: u16) -> Result<()> {
    // Force flush to ensure logs are written
    eprintln!("=== RUST EXECUTOR STARTING (SERVER MODE) ===");
    eprintln!(
        "Environment: PORT={}, RUST_LOG={}",
        port,
        std::env::var("RUST_LOG").unwrap_or_else(|_| "not set".to_string())
    );

    info!("Starting Workflow Executor API");

    // Initialize database connection pool
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://localhost/mediar_workflows".to_string());

    info!(
        "Attempting to connect to database: {}",
        database_url.split('@').next_back().unwrap_or("unknown")
    );

    // Try to connect with timeout
    let db_pool_result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        create_pool(&database_url),
    )
    .await;

    let db_pool = match db_pool_result {
        Ok(Ok(pool)) => {
            info!("✓ Database connection pool created successfully");
            pool
        }
        Ok(Err(e)) => {
            error!("✗ Database connection failed: {}", e);
            error!("  Possible causes:");
            error!("  1. Incorrect DATABASE_URL format");
            error!("  2. Database server is not accessible");
            error!("  3. Invalid credentials");
            error!("  4. SSL/TLS configuration mismatch");
            error!("  Creating empty pool to allow API to start");
            // Return error but with better message
            return Err(anyhow::anyhow!(
                "Database connection failed: {e}. Check network connectivity to Supabase."
            ));
        }
        Err(_) => {
            error!("✗ Database connection timed out after 10 seconds");
            error!("  This usually means DNS resolution or network connectivity issues");
            error!(
                "  Check that the container can reach: {}",
                database_url.split('@').next_back().unwrap_or("unknown")
            );
            return Err(anyhow::anyhow!(
                "Database connection timeout. Network/DNS issue suspected."
            ));
        }
    };

    // Clean up any stuck Rust executions from previous runs (crash recovery)
    // Use 1 minute threshold - any execution started > 1 min ago that's still "running" is stuck
    info!("Checking for stuck executions from previous runs...");
    match db::queries::WorkflowQueries::cleanup_stuck_rust_executions(&db_pool, 1).await {
        Ok(count) if count > 0 => {
            info!(
                "✓ Cleaned up {} stuck Rust executions from previous run",
                count
            );
        }
        Ok(_) => {
            info!("✓ No stuck executions found");
        }
        Err(e) => {
            error!(
                "Failed to cleanup stuck executions: {} (continuing anyway)",
                e
            );
        }
    }

    // Create shared cancellation registry
    let cancellation_registry = CancellationRegistry::new();
    info!("Cancellation registry initialized");

    // Start queue processor in background with shared registry
    info!("Starting queue processor...");
    let queue_processor = QueueProcessor::with_registry(db_pool.clone(), cancellation_registry.clone());
    tokio::spawn(async move {
        info!("Queue processor task spawned, starting polling loop");
        if let Err(e) = queue_processor.start().await {
            error!("Queue processor error: {}", e);
        }
    });
    info!("Queue processor started");

    // Build API router with shared state (db_pool + cancellation_registry)
    let app_state = AppState::new(db_pool, cancellation_registry);
    let app = build_router(app_state)?;

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app).await.map_err(|e| {
        error!("Server error: {}", e);
        anyhow::anyhow!("Server error: {e}")
    })?;

    Ok(())
}

async fn run_workflow_directly(machine: String, workflow: String) -> Result<()> {
    eprintln!("=== RUST EXECUTOR - DIRECT RUN MODE ===");
    eprintln!("Machine: {machine}");
    eprintln!("Workflow: {workflow}");

    info!("Starting direct workflow execution");
    info!("Machine: {}, Workflow: {}", machine, workflow);

    // Initialize database connection
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://localhost/mediar_workflows".to_string());

    let db_pool = create_pool(&database_url).await?;

    // Determine MCP endpoint based on machine name
    let mcp_endpoint = match machine.to_lowercase().as_str() {
        "vm1" => "http://172.190.244.122:8080".to_string(),
        "vm2" => "http://4.227.217.44:8080".to_string(),
        url if url.starts_with("http://") || url.starts_with("https://") => url.to_string(),
        _ => {
            // Try to look up machine by name in database
            // For now, return an error
            return Err(anyhow::anyhow!(
                "Unknown machine: {machine}. Use vm1, vm2, or provide a full MCP endpoint URL"
            ));
        }
    };

    info!("Using MCP endpoint: {}", mcp_endpoint);

    // Look up workflow
    let workflow_id = if uuid::Uuid::parse_str(&workflow).is_ok() {
        workflow.clone()
    } else {
        // Try to look up workflow by name
        // For now, we'll need to implement this lookup
        info!("Looking up workflow by name: {}", workflow);

        // Query database for workflow
        let query = r#"
            SELECT id::text
            FROM deployed_workflows
            WHERE name = $1 OR github_folder = $1
            LIMIT 1
        "#;

        let row = sqlx::query_scalar::<_, String>(query)
            .bind(&workflow)
            .fetch_optional(&db_pool)
            .await?;

        match row {
            Some(id) => {
                info!("Found workflow ID: {}", id);
                id
            }
            None => {
                return Err(anyhow::anyhow!("Workflow not found: {workflow}"));
            }
        }
    };

    info!("Workflow ID: {}", workflow_id);

    // Parse workflow_id as integer (deployed_workflows uses integer IDs)
    let workflow_id_int: i64 = workflow_id
        .parse()
        .map_err(|e| anyhow::anyhow!("Invalid workflow ID '{workflow_id}': {e}"))?;

    // Get workflow details to check if it's TypeScript
    let workflow = db::queries::WorkflowQueries::get_workflow(&db_pool, workflow_id_int)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Workflow not found: {workflow_id_int}"))?;

    // Check if this is a TypeScript workflow
    if workflow.preferred_format.as_deref() == Some("typescript") {
        info!("Detected TypeScript workflow - executing via execute_sequence MCP tool");
        eprintln!("📦 TypeScript workflow detected");

        // Create MCP client for both download and execution
        let mcp_client = mcp::McpClient::from_url(mcp_endpoint.clone());

        // Determine execution path: UUID-based (new) or github_folder (legacy)
        let has_release = workflow.github_release_url.is_some();
        let vm_workflow_path = if has_release {
            // NEW ARCHITECTURE: UUID-based download from Next.js route
            info!("Using new UUID-based architecture with GitHub releases");
            eprintln!("🆕 UUID-based workflow (GitHub releases)");

            let workflow_uuid = workflow
                .uuid
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("TypeScript workflow missing uuid"))?;

            let org_id = workflow
                .organization_id
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("TypeScript workflow missing organization_id"))?;

            // Get service token from environment
            let service_token = std::env::var("MCP_SERVICE_TOKEN")
                .context("MCP_SERVICE_TOKEN environment variable not set")?;

            // Build download URL
            let download_url = format!(
                "https://app.mediar.ai/api/workflows-uuid/download?uuid={}",
                workflow_uuid
            );

            info!(
                "Downloading workflow {} from {}",
                workflow_uuid, download_url
            );
            eprintln!("📥 Downloading workflow from releases...");

            // Download and extract workflow to S:\{uuid}\
            let downloaded_path = crate::workflow_downloader::ensure_workflow_downloaded(
                &mcp_client,
                workflow_uuid,
                org_id,
                &service_token,
                &download_url,
            )
            .await?;

            // Convert to file:// URL format
            let normalized_path = downloaded_path.replace("\\", "/");
            format!("file://{}", normalized_path)
        } else {
            // LEGACY ARCHITECTURE: S3 mount with github_folder
            info!("Using legacy S3 mount architecture");
            eprintln!("📁 Legacy workflow (S3 mount)");

            let github_folder = workflow.github_folder.as_ref().ok_or_else(|| {
                anyhow::anyhow!(
                    "TypeScript workflow missing both github_release_url and github_folder"
                )
            })?;

            // The Windows VMs have S3 bucket mounted to S: drive via rclone
            // Structure: S:\org-{clerk_org_id}\workflows\{workflow_id}\
            let vm_workflow_path = if let Some(org_id) = &workflow.organization_id {
                let windows_path = format!(r"S:\org-{org_id}\workflows\{workflow_id_int}");
                let normalized_path = windows_path.replace("\\", "/");
                format!("file://{normalized_path}")
            } else {
                eprintln!("⚠️  Warning: No organization_id found, passing folder name only");
                github_folder.to_string()
            };

            vm_workflow_path
        };

        info!("TypeScript workflow path on VM: {}", vm_workflow_path);
        eprintln!("📁 VM workflow path: {vm_workflow_path}");
        let mut args = serde_json::Map::new();
        args.insert(
            "url".to_string(),
            serde_json::Value::String(vm_workflow_path),
        );
        args.insert("stop_on_error".to_string(), serde_json::Value::Bool(true));
        args.insert(
            "include_detailed_results".to_string(),
            serde_json::Value::Bool(true),
        );

        eprintln!("🚀 Executing TypeScript workflow via MCP...");

        // Execute via MCP execute_sequence tool
        let result = mcp_client
            .execute_tool_with_retry(
                "execute_sequence".to_string(),
                Some(args),
                3, // max retries
            )
            .await?;

        info!("TypeScript workflow execution completed");
        eprintln!("✓ TypeScript workflow execution completed");
        eprintln!("\nResult:");
        eprintln!("{}", serde_json::to_string_pretty(&result)?);

        return Ok(());
    }

    // For YAML workflows, use the normal execution path
    info!("Executing YAML workflow via WorkflowService");

    // Create executor and run the workflow
    let executor = services::WorkflowService::new(db_pool.clone());

    // Create execution request
    let request = ExecutionRequest {
        workflow_id: workflow_id_int,
        execution_params: Some(serde_json::json!({})),
        client_id: None,
        version_number: None,
        mcp_endpoint: mcp_endpoint.clone(),
    };

    eprintln!("Executing workflow...");
    match executor.execute_workflow(request).await {
        Ok(_) => {
            info!("✓ Workflow execution completed successfully");
            eprintln!("✓ Workflow execution completed successfully");
        }
        Err(e) => {
            error!("✗ Workflow execution failed: {}", e);
            eprintln!("✗ Workflow execution failed: {e}");
            return Err(e);
        }
    }

    Ok(())
}

fn build_router(app_state: AppState) -> Result<Router> {
    let app = Router::new()
        .nest("/api/v1", api::routes())
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB max body size
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .layer(sentry_tower::NewSentryLayer::new_from_top())
        .layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
        .with_state(app_state);

    Ok(app)
}

fn init_tracing() {
    use tracing_subscriber::prelude::*;

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "workflow_executor=debug,tower_http=debug,info".into());

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_level(true)
        .with_thread_ids(true);

    // Initialize Sentry if DSN is provided
    let sentry_layer = Some("https://f5832483657723604d167b937d0dfaaf@o4507617161314304.ingest.us.sentry.io/4510365180362752".to_string())
        .and_then(|dsn| {
            if dsn.is_empty() {
                None
            } else {
                eprintln!("✓ Initializing Sentry");

                // Configure Sentry
                let _guard = sentry::init((
                    dsn,
                    sentry::ClientOptions {
                        release: sentry::release_name!(),
                        environment: Some(
                            std::env::var("ENVIRONMENT")
                                .unwrap_or_else(|_| "production".to_string())
                                .into()
                        ),
                        traces_sample_rate: 0.1, // 10% of transactions
                        debug: std::env::var("SENTRY_DEBUG").is_ok(),
                        attach_stacktrace: true,
                        ..Default::default()
                    },
                ));

                // Create tracing layer for Sentry
                Some(sentry_tracing::layer())
            }
        });

    // Initialize OpenTelemetry layer (traces + logs)
    // Do this AFTER Sentry to avoid type issues
    let otel_layer = telemetry::init_telemetry();

    // Build subscriber with all layers using the type-safe approach
    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer);

    // Add Sentry layer if available
    let subscriber = subscriber.with(sentry_layer);

    // Add OpenTelemetry layer if available
    let subscriber = subscriber.with(otel_layer);

    // Initialize the subscriber
    subscriber.init();

    eprintln!("✓ Tracing initialized");
}
