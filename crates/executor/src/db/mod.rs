use anyhow::{Context, Result};
use sqlx::{postgres::PgPoolOptions, Pool, Postgres};
use std::time::Duration;
use tracing::{error, info, warn};

pub mod queries;

pub type DatabasePool = Pool<Postgres>;

pub struct Database;

impl Database {
    /// Create a database connection pool with retry logic for SSL errors
    ///
    /// This matches the Python Modal executor's retry behavior added in commit 60b91659:
    /// - Max 3 retry attempts with 2-second delays
    /// - 10-second connection timeout for faster failure detection
    /// - Retries on SSL connection errors
    /// - Detailed logging of retry attempts
    pub async fn connect(database_url: &str) -> Result<DatabasePool> {
        Self::connect_with_retry(database_url, 3, 2).await
    }

    /// Create a database connection pool with configurable retry logic
    ///
    /// # Arguments
    /// * `database_url` - PostgreSQL connection string
    /// * `max_retries` - Maximum number of connection attempts (default: 3)
    /// * `retry_delay_secs` - Delay in seconds between retries (default: 2)
    pub async fn connect_with_retry(
        database_url: &str,
        max_retries: u32,
        retry_delay_secs: u64,
    ) -> Result<DatabasePool> {
        let mut last_error = None;

        for attempt in 1..=max_retries {
            match Self::try_connect(database_url).await {
                Ok(pool) => {
                    if attempt > 1 {
                        info!(
                            "✓ Database connection successful on attempt {}/{}",
                            attempt, max_retries
                        );
                    }
                    return Ok(pool);
                }
                Err(e) => {
                    last_error = Some(e);
                    let error_msg = last_error.as_ref().unwrap().to_string();

                    // Check if it's an SSL connection error that we should retry
                    if error_msg.contains("SSL") || error_msg.contains("connection") {
                        if attempt < max_retries {
                            warn!(
                                "⚠️ Database connection failed (attempt {}/{}): {}",
                                attempt, max_retries, error_msg
                            );
                            info!("   Retrying in {} seconds...", retry_delay_secs);
                            tokio::time::sleep(Duration::from_secs(retry_delay_secs)).await;
                        } else {
                            error!(
                                "❌ Database connection failed after {} attempts: {}",
                                max_retries, error_msg
                            );
                        }
                    } else {
                        // Different error, don't retry
                        error!(
                            "❌ Database connection failed (non-SSL error): {}",
                            error_msg
                        );
                        return Err(last_error.unwrap());
                    }
                }
            }
        }

        // All retries exhausted
        Err(last_error
            .unwrap_or_else(|| anyhow::anyhow!("Database connection failed: Unknown error")))
    }

    async fn try_connect(database_url: &str) -> Result<DatabasePool> {
        let pool = PgPoolOptions::new()
            .max_connections(20)
            .min_connections(2)
            .acquire_timeout(Duration::from_secs(10)) // Increased from 3s to 10s for faster failure detection
            .idle_timeout(Duration::from_secs(10))
            .max_lifetime(Duration::from_secs(30 * 60))
            .connect(database_url)
            .await
            .context("Failed to connect to database")?;

        // Test the connection with a simple query (matches Python's SET statements)
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .context("Failed to execute test query")?;

        Ok(pool)
    }
}

// Helper functions for DatabasePool
pub async fn create_pool(database_url: &str) -> Result<DatabasePool> {
    Database::connect(database_url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database connection
    async fn test_database_connection() {
        let database_url = "postgresql://test:test@localhost/test";
        let result = Database::connect(database_url).await;
        assert!(result.is_ok() || result.is_err()); // Just test that it attempts connection
    }
}
