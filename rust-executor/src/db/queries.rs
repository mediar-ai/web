use sqlx::{Pool, Postgres, Row};
use chrono::Utc;
use anyhow::Result;
use crate::models::{Workflow, WorkflowExecution, ExecutionStatus, WorkflowStatus};
use serde_json::Value;

pub struct WorkflowQueries;

impl WorkflowQueries {
    pub async fn get_workflow(
        pool: &Pool<Postgres>,
        workflow_id: i64,
    ) -> Result<Option<Workflow>> {
        // CRITICAL FIX: Join with deployed_workflow_versions to get the ACTIVE version
        // Previously used deployed_workflows_with_sequence view which returned stale YAML
        let workflow = sqlx::query(
            r#"
            SELECT
                dw.id,
                dw.name,
                dwv.version_number as version,
                dw.description,
                dw.status,
                dw.category,
                dw.github_folder,
                dw.github_ref,
                dwv.automation_sequence,
                dwv.automation_sequence_yaml,
                dw.created_at,
                dw.updated_at
            FROM deployed_workflows dw
            JOIN deployed_workflow_versions dwv ON dw.id = dwv.workflow_id
            WHERE dw.id = $1 AND dwv.is_active = true
            "#,
        )
        .bind(workflow_id)
        .fetch_optional(pool)
        .await?
        .map(|row| Workflow {
            id: row.get("id"),
            name: row.get("name"),
            version: row.get("version"),
            description: row.get("description"),
            status: match row.get::<String, _>("status").as_str() {
                "deployed" => WorkflowStatus::Deployed,
                "paused" => WorkflowStatus::Paused,
                "draft" => WorkflowStatus::Draft,
                "archived" => WorkflowStatus::Archived,
                _ => WorkflowStatus::Draft,
            },
            category: row.get("category"),
            github_folder: row.get("github_folder"),
            github_ref: row.get("github_ref"),
            automation_sequence: row.get("automation_sequence"),
            automation_sequence_yaml: row.get("automation_sequence_yaml"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });

        Ok(workflow)
    }

    pub async fn get_workflow_by_version(
        pool: &Pool<Postgres>,
        version: &str,
    ) -> Result<Option<Workflow>> {
        let workflow = sqlx::query(
            r#"
            SELECT
                id, name, version, description,
                status, category, github_folder, github_ref,
                automation_sequence, automation_sequence_yaml,
                created_at, updated_at
            FROM deployed_workflows_with_sequence
            WHERE version = $1 AND status = 'deployed'
            LIMIT 1
            "#,
        )
        .bind(version)
        .fetch_optional(pool)
        .await?
        .map(|row| Workflow {
            id: row.get("id"),
            name: row.get("name"),
            version: row.get("version"),
            description: row.get("description"),
            status: WorkflowStatus::Deployed,
            category: row.get("category"),
            github_folder: row.get("github_folder"),
            github_ref: row.get("github_ref"),
            automation_sequence: row.get("automation_sequence"),
            automation_sequence_yaml: row.get("automation_sequence_yaml"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });

        Ok(workflow)
    }

    pub async fn create_execution(
        pool: &Pool<Postgres>,
        workflow_id: i64,
        client_id: Option<String>,
        execution_params: Option<Value>,
    ) -> Result<i64> {
        let now = Utc::now();

        let result = sqlx::query(
            r#"
            INSERT INTO workflow_executions (
                workflow_id, status, client_id,
                execution_params, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            "#,
        )
        .bind(workflow_id)
        .bind("queued")
        .bind(client_id)
        .bind(execution_params)
        .bind(now)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(result.get("id"))
    }

    pub async fn claim_execution(
        pool: &Pool<Postgres>,
        _machine_id: &str,
    ) -> Result<Option<WorkflowExecution>> {
        // Don't update assigned_machine_id - it's already set by the API
        // and must reference a valid remote_machines.id (foreign key constraint)

        let result = sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = $1,
                started_at = NOW(),
                updated_at = NOW()
            WHERE id = (
                SELECT id FROM workflow_executions
                WHERE status = $2
                AND executor_type = 'rust'
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING
                id, workflow_id, status,
                client_id, execution_params, assigned_machine_id,
                mcp_endpoint,
                started_at, completed_at, error_message,
                results, execution_logs, total_steps,
                current_step_description, created_at, updated_at
            "#,
        )
        .bind("running")
        .bind("queued")
        .fetch_optional(pool)
        .await?;

        if let Some(row) = result {
            Ok(Some(WorkflowExecution {
                id: row.get("id"),
                workflow_id: row.get("workflow_id"),
                status: Self::parse_execution_status(row.get("status")),
                client_id: row.get("client_id"),
                execution_params: row.get("execution_params"),
                machine_id: row.get("assigned_machine_id"),
                mcp_endpoint: row.get("mcp_endpoint"),
                started_at: row.get("started_at"),
                completed_at: row.get("completed_at"),
                error_message: row.get("error_message"),
                result: row.get("results"),
                logs: row.get("execution_logs"),
                total_steps: row.get("total_steps"),
                completed_steps: None, // Column does not exist in schema
                current_step: row.get("current_step_description"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn update_execution_status(
        pool: &Pool<Postgres>,
        execution_id: i64,
        status: ExecutionStatus,
        error_message: Option<String>,
        result: Option<Value>,
    ) -> Result<()> {
        let now = Utc::now();
        let status_str = Self::execution_status_to_string(&status);

        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = $1,
                error_message = $2,
                results = $3,
                completed_at = $4,
                updated_at = $5
            WHERE id = $6
            "#,
        )
        .bind(status_str)
        .bind(error_message)
        .bind(result)
        .bind(if matches!(status, ExecutionStatus::Completed | ExecutionStatus::Failed | ExecutionStatus::Cancelled | ExecutionStatus::Exception) {
            Some(now)
        } else {
            None
        })
        .bind(now)
        .bind(execution_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Update execution with screenshot URLs
    pub async fn update_execution_screenshots(
        pool: &Pool<Postgres>,
        execution_id: i64,
        screenshot_urls: Vec<String>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                screenshot_urls = $1,
                updated_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(screenshot_urls)
        .bind(execution_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn update_execution_progress(
        pool: &Pool<Postgres>,
        execution_id: i64,
        _completed_steps: u32,
        total_steps: u32,
        current_step: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                total_steps = $1,
                current_step_description = $2,
                updated_at = NOW()
            WHERE id = $3
            "#,
        )
        .bind(total_steps as i32)
        .bind(current_step)
        .bind(execution_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn check_failure_patterns(
        pool: &Pool<Postgres>,
        workflow_id: i64,
    ) -> Result<bool> {
        let result = sqlx::query(
            r#"
            SELECT COUNT(*) as count
            FROM (
                SELECT error_message
                FROM workflow_executions
                WHERE workflow_id = $1
                AND status = 'failed'
                AND completed_at > NOW() - INTERVAL '10 minutes'
                ORDER BY completed_at DESC
                LIMIT 3
            ) recent_failures
            WHERE error_message IS NOT NULL
            GROUP BY error_message
            HAVING COUNT(*) >= 3
            "#,
        )
        .bind(workflow_id)
        .fetch_optional(pool)
        .await?;

        Ok(result.is_some())
    }

    // Helper functions for status conversion
    pub fn parse_execution_status(status: String) -> ExecutionStatus {
        match status.as_str() {
            "queued" => ExecutionStatus::Queued,
            "running" => ExecutionStatus::Running,
            "completed" => ExecutionStatus::Completed,
            "failed" => ExecutionStatus::Failed,
            "cancelled" => ExecutionStatus::Cancelled,
            "paused" => ExecutionStatus::Paused,
            "exception" => ExecutionStatus::Exception,
            _ => ExecutionStatus::Queued,
        }
    }

    fn execution_status_to_string(status: &ExecutionStatus) -> &'static str {
        match status {
            ExecutionStatus::Queued => "queued",
            ExecutionStatus::Running => "running",
            ExecutionStatus::Completed => "completed",
            ExecutionStatus::Failed => "failed",
            ExecutionStatus::Cancelled => "cancelled",
            ExecutionStatus::Paused => "paused",
            ExecutionStatus::Exception => "exception",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database
    async fn test_workflow_queries() {
        let pool = sqlx::postgres::PgPool::connect("postgresql://test:test@localhost/test")
            .await
            .unwrap();

        let workflow_id = 1i64;
        let result = WorkflowQueries::get_workflow(&pool, workflow_id).await;
        assert!(result.is_ok());
    }
}