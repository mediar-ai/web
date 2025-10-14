use anyhow::Result;
use axum::{
    Router,
    extract::DefaultBodyLimit,
};
use std::net::SocketAddr;
use tower_http::{
    cors::CorsLayer,
    compression::CompressionLayer,
    trace::TraceLayer,
};
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod models;
mod db;
mod mcp;
mod api;
mod services;
mod utils;

use crate::db::{DatabasePool, create_pool};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing
    init_tracing();

    // Force flush to ensure logs are written
    eprintln!("=== RUST EXECUTOR STARTING ===");
    eprintln!("Environment: PORT={}, RUST_LOG={}",
        std::env::var("PORT").unwrap_or_else(|_| "not set".to_string()),
        std::env::var("RUST_LOG").unwrap_or_else(|_| "not set".to_string())
    );

    info!("Starting Workflow Executor API");

    // Initialize database connection pool
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://localhost/mediar_workflows".to_string());

    info!("Attempting to connect to database: {}", database_url.split('@').last().unwrap_or("unknown"));

    // Try to connect with timeout
    let db_pool_result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        create_pool(&database_url)
    ).await;

    let db_pool = match db_pool_result {
        Ok(Ok(pool)) => {
            info!("✓ Successfully connected to database");
            pool
        }
        Ok(Err(e)) => {
            error!("✗ Failed to connect to database: {}", e);
            error!("  Creating empty pool to allow API to start");
            // Return error but with better message
            return Err(anyhow::anyhow!("Database connection failed: {}. Check network connectivity to Supabase.", e));
        }
        Err(_) => {
            error!("✗ Database connection timed out after 10 seconds");
            error!("  This usually means DNS resolution or network connectivity issues");
            error!("  Check that the container can reach: {}", database_url.split('@').last().unwrap_or("unknown"));
            return Err(anyhow::anyhow!("Database connection timeout. Network/DNS issue suspected."));
        }
    };

    // Build API router
    let app = build_router(db_pool)?;

    // Start server
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()?;

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app)
        .await
        .map_err(|e| {
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

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .init();
}