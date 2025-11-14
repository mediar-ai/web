use anyhow::Result;
use axum::{extract::DefaultBodyLimit, Router};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod db;
mod mcp;
mod models;
mod services;
mod storage;
mod utils;

use crate::db::{create_pool, DatabasePool};
use crate::services::QueueProcessor;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing (with Sentry if configured)
    init_tracing();

    // Force flush to ensure logs are written
    eprintln!("=== RUST EXECUTOR STARTING ===");
    eprintln!(
        "Environment: PORT={}, RUST_LOG={}",
        std::env::var("PORT").unwrap_or_else(|_| "not set".to_string()),
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
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()?;

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app).await.map_err(|e| {
        error!("Server error: {}", e);
        anyhow::anyhow!("Server error: {}", e)
    })?;

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
                eprintln!("Initializing Sentry with DSN");
                
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

    // Build subscriber with conditional Sentry layer
    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer);

    if let Some(sentry_layer) = sentry_layer {
        subscriber.with(sentry_layer).init();
        eprintln!("Tracing initialized with Sentry integration");
    } else {
        subscriber.init();
        eprintln!("Tracing initialized without Sentry (no SENTRY_DSN configured)");
    }
}
