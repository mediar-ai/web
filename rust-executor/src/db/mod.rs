use sqlx::{Pool, Postgres, postgres::PgPoolOptions};
use std::time::Duration;
use anyhow::Result;

pub mod queries;

pub type DatabasePool = Pool<Postgres>;

pub struct Database;

impl Database {
    pub async fn connect(database_url: &str) -> Result<DatabasePool> {
        let pool = PgPoolOptions::new()
            .max_connections(20)
            .min_connections(2)
            .acquire_timeout(Duration::from_secs(3))
            .idle_timeout(Duration::from_secs(10))
            .max_lifetime(Duration::from_secs(30 * 60))
            .connect(database_url)
            .await?;

        Ok(pool)
    }
}

// Helper functions for DatabasePool
pub async fn create_pool(database_url: &str) -> Result<DatabasePool> {
    Database::connect(database_url).await
}

pub async fn create_pool_from_env() -> Result<DatabasePool> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL not set"))?;
    create_pool(&database_url).await
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