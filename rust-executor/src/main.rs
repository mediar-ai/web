use anyhow::Result;
use axum::{extract::DefaultBodyLimit, Router};
use clap::{Parser, Subcommand};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod db;
mod logging;
mod mcp;
mod models;
mod services;
mod storage;
mod telemetry;
mod utils;

use crate::db::{create_pool, DatabasePool};
use crate::models::ExecutionRequest;
use crate::services::QueueProcessor;

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

    // Initialize tracing (with Sentry if configured)
    init_tracing();

    // Initialize OpenTelemetry tracing (after logging is set up)
    telemetry::init_telemetry();

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
        Some(Commands::Run { machine, workflow }) => {
            run_workflow_directly(machine, workflow).await
        }
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
        database_url.split('@').last().unwrap_or("unknown")
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
                "Database connection failed: {}. Check network connectivity to Supabase.",
                e
            ));
        }
        Err(_) => {
            error!("✗ Database connection timed out after 10 seconds");
            error!("  This usually means DNS resolution or network connectivity issues");
            error!(
                "  Check that the container can reach: {}",
                database_url.split('@').last().unwrap_or("unknown")
            );
            return Err(anyhow::anyhow!(
                "Database connection timeout. Network/DNS issue suspected."
            ));
        }
    };

    // Start queue processor in background
    info!("Starting queue processor...");
    let queue_processor = QueueProcessor::new(db_pool.clone());
    tokio::spawn(async move {
        info!("Queue processor task spawned, starting polling loop");
        if let Err(e) = queue_processor.start().await {
            error!("Queue processor error: {}", e);
        }
    });
    info!("✓ Queue processor started");

    // Build API router
    let app = build_router(db_pool)?;

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app).await.map_err(|e| {
        error!("Server error: {}", e);
        anyhow::anyhow!("Server error: {}", e)
    })?;

    Ok(())
}

async fn run_workflow_directly(machine: String, workflow: String) -> Result<()> {
    eprintln!("=== RUST EXECUTOR - DIRECT RUN MODE ===");
    eprintln!("Machine: {}", machine);
    eprintln!("Workflow: {}", workflow);

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
            return Err(anyhow::anyhow!("Unknown machine: {}. Use vm1, vm2, or provide a full MCP endpoint URL", machine));
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
            FROM workflows
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
                return Err(anyhow::anyhow!("Workflow not found: {}", workflow));
            }
        }
    };

    info!("Workflow ID: {}", workflow_id);

    // Create a workflow execution
    let execution_id = uuid::Uuid::new_v4();
    let query = r#"
        INSERT INTO workflow_executions
        (id, workflow_id, status, parameters, machine_id, created_at, updated_at)
        VALUES ($1, $2, 'queued', '{}', $3, NOW(), NOW())
        RETURNING id::text
    "#;

    sqlx::query_scalar::<_, String>(query)
        .bind(&execution_id)
        .bind(&uuid::Uuid::parse_str(&workflow_id)?)
        .bind(&machine)
        .fetch_one(&db_pool)
        .await?;

    info!("Created execution: {}", execution_id);
    eprintln!("Created execution: {}", execution_id);

    // Get workflow information from database
    let workflow_query = r#"
        SELECT id::text, json_id
        FROM workflows
        WHERE id = $1
        LIMIT 1
    "#;

    let workflow_info = sqlx::query_as::<_, (String, Option<i64>)>(workflow_query)
        .bind(&uuid::Uuid::parse_str(&workflow_id)?)
        .fetch_one(&db_pool)
        .await?;

    let workflow_json_id = workflow_info.1
        .ok_or_else(|| anyhow::anyhow!("Workflow missing json_id"))?;

    // Create executor and run the workflow
    let executor = services::WorkflowService::new(db_pool.clone());

    // Create execution request
    let request = ExecutionRequest {
        workflow_id: workflow_json_id,
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
            eprintln!("Execution ID: {}", execution_id);
        }
        Err(e) => {
            error!("✗ Workflow execution failed: {}", e);
            eprintln!("✗ Workflow execution failed: {}", e);
            return Err(e);
        }
    }

    Ok(())
}

fn build_router(db_pool: DatabasePool) -> Result<Router> {
    let app = Router::new()
        .nest("/api/v1", api::routes())
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB max body size
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .layer(sentry_tower::NewSentryLayer::new_from_top())
        .layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
        .with_state(db_pool);

    Ok(app)
}

fn init_tracing() {
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

    // Build subscriber with all layers
    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer);

    // Add Sentry layer if available
    if let Some(sentry) = sentry_layer {
        registry.with(sentry).init();
        eprintln!("✓ Tracing initialized with Sentry");
    } else {
        registry.init();
        eprintln!("✓ Tracing initialized without Sentry");
    }

    // Note: OpenTelemetry logs are initialized separately to avoid type complexity
    // The OTLP layer will be created when telemetry::init_telemetry() is called
}