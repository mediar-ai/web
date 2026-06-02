use crate::models::{ExecutionStatus, Workflow, WorkflowExecution, WorkflowStatus};
use anyhow::Result;
use chrono::Utc;
use serde_json::Value;
use sqlx::{Pool, Postgres, Row};

pub struct WorkflowQueries;

impl WorkflowQueries {
    pub async fn get_workflow(pool: &Pool<Postgres>, workflow_id: i64) -> Result<Option<Workflow>> {
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
                dw.organization_id,
                -- Prefer the ACTIVE version's format (authoritative, written alongside
                -- automation_sequence). The parent dw.preferred_format is stale for
                -- TypeScript workflows: publish-typescript only writes the flag to the
                -- version row, never the parent, so dw.preferred_format stays null and
                -- TS workflows wrongly route to the structured-step executor.
                COALESCE(dwv.preferred_format, dw.preferred_format) as preferred_format,
                dwv.automation_sequence,
                dwv.automation_sequence_yaml,
                dw.skip_next_cancellation_check,
                dw.created_at,
                dw.updated_at,
                dw.uuid::text as uuid,
                dw.github_repo_url,
                dw.github_release_url,
                dw.github_release_checksum,
                dw.package_json_version
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
            organization_id: row.get("organization_id"),
            preferred_format: row.get("preferred_format"),
            automation_sequence: row.get("automation_sequence"),
            uuid: row.get("uuid"),
            github_repo_url: row.get("github_repo_url"),
            github_release_url: row.get("github_release_url"),
            github_release_checksum: row.get("github_release_checksum"),
            package_json_version: row.get("package_json_version"),
            automation_sequence_yaml: row.get("automation_sequence_yaml"),
            skip_next_cancellation_check: row.get("skip_next_cancellation_check"),
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

    /// Set the OpenTelemetry trace_id for an execution
    /// This enables reliable log correlation with ClickHouse
    pub async fn set_trace_id(
        pool: &Pool<Postgres>,
        execution_id: i64,
        trace_id: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                trace_id = $1,
                updated_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(trace_id)
        .bind(execution_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn claim_execution(
        pool: &Pool<Postgres>,
        _machine_id: &str,
    ) -> Result<Option<WorkflowExecution>> {
        // Don't update assigned_machine_id - it's already set by the API
        // and must reference a valid remote_machines.id (foreign key constraint)
        //
        // IMPORTANT: Only claim executions where the assigned machine doesn't have
        // another execution currently running. This ensures one workflow per machine.
        // FIX: Also clear completed_at when claiming retried executions to prevent
        // negative duration (completed_at < started_at) in UI

        let result = sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'running',
                started_at = NOW(),
                completed_at = NULL,
                updated_at = NOW()
            WHERE id = (
                SELECT we.id FROM workflow_executions we
                WHERE (
                    (we.status = 'queued' AND we.executor_type = 'rust')
                    OR
                    (we.status = 'failed' AND we.is_retryable = TRUE AND we.next_retry_at <= NOW() AND we.executor_type = 'rust')
                )
                -- Only claim if the assigned machine doesn't have a running execution
                AND NOT EXISTS (
                    SELECT 1 FROM workflow_executions running
                    WHERE running.assigned_machine_id = we.assigned_machine_id
                    AND running.status = 'running'
                    AND running.id != we.id
                )
                ORDER BY
                    we.priority DESC NULLS LAST,
                    we.retry_count ASC,
                    we.created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING
                id, workflow_id, status,
                client_id, execution_params, assigned_machine_id,
                mcp_endpoint,
                started_at, completed_at, error_message,
                results, execution_logs, total_steps,
                current_step_description, created_at, updated_at,
                retry_count, max_retries, next_retry_at,
                is_retryable, error_category,
                start_from_step, end_at_step, follow_fallback, execute_jumps_at_end
            "#,
        )
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
                current_step: row.get("current_step_description"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
                retry_count: row.get("retry_count"),
                max_retries: row.get("max_retries"),
                next_retry_at: row.get("next_retry_at"),
                is_retryable: row.get("is_retryable"),
                error_category: row.get("error_category"),
                start_from_step: row.get("start_from_step"),
                end_at_step: row.get("end_at_step"),
                follow_fallback: row.get("follow_fallback"),
                execute_jumps_at_end: row.get("execute_jumps_at_end"),
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
        formatted_output: Option<String>,
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
                updated_at = $5,
                formatted_output = $6
            WHERE id = $7
            "#,
        )
        .bind(status_str)
        .bind(error_message)
        .bind(result)
        .bind(
            if matches!(
                status,
                ExecutionStatus::Completed
                    | ExecutionStatus::Failed
                    | ExecutionStatus::Cancelled
                    | ExecutionStatus::Exception
            ) {
                Some(now)
            } else {
                None
            },
        )
        .bind(now)
        .bind(formatted_output)
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

    /// Schedule an execution for retry after infrastructure failure
    // IMPORTANT: Clear completed_at, formatted_output, error_message when scheduling retry
    // Otherwise, re-claimed execution will have stale completed_at < started_at
    // causing negative duration display in UI
    pub async fn schedule_retry(
        pool: &Pool<Postgres>,
        execution_id: i64,
        retry_count: i32,
        next_retry_at: chrono::DateTime<Utc>,
        error_category: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'queued',
                retry_count = $2,
                next_retry_at = $3,
                is_retryable = TRUE,
                error_category = $4,
                completed_at = NULL,
                formatted_output = NULL,
                error_message = NULL,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(execution_id)
        .bind(retry_count)
        .bind(next_retry_at)
        .bind(error_category)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Mark execution as permanently failed (no more retries)
    pub async fn mark_failed_permanently(
        pool: &Pool<Postgres>,
        execution_id: i64,
        error_message: &str,
        error_category: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'failed',
                error_message = $2,
                is_retryable = FALSE,
                error_category = $3,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(execution_id)
        .bind(error_message)
        .bind(error_category)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn check_failure_patterns(pool: &Pool<Postgres>, workflow_id: i64) -> Result<bool> {
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

    /// Clean up stuck Rust executor executions on startup
    /// This handles executions that were left in 'running' state when the executor crashed/restarted
    pub async fn cleanup_stuck_rust_executions(
        pool: &Pool<Postgres>,
        stale_threshold_minutes: i32,
    ) -> Result<i32> {
        // Find and mark stuck Rust executions as failed
        let result = sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'failed',
                completed_at = NOW(),
                error_message = 'Auto-cleanup: Rust executor restarted while execution was running (stuck for ' ||
                    EXTRACT(EPOCH FROM (NOW() - started_at))::integer / 60 || ' minutes)',
                execution_duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer,
                updated_at = NOW()
            WHERE
                status = 'running'
                AND executor_type = 'rust'
                AND started_at < NOW() - INTERVAL '1 minute' * $1
            RETURNING id
            "#,
        )
        .bind(stale_threshold_minutes)
        .fetch_all(pool)
        .await?;

        Ok(result.len() as i32)
    }

    /// Periodic cleanup of stuck Rust executor executions
    /// Call this periodically from the queue processor
    pub async fn cleanup_stale_executions(
        pool: &Pool<Postgres>,
        stale_threshold_minutes: i32,
    ) -> Result<i32> {
        // Clean up Rust executor executions stuck in running for too long
        let result = sqlx::query(
            r#"
            UPDATE workflow_executions
            SET
                status = 'failed',
                completed_at = NOW(),
                error_message = 'Auto-cleanup: Rust executor execution stuck in running state for ' ||
                    EXTRACT(EPOCH FROM (NOW() - started_at))::integer / 60 || '+ minutes (executor timeout or crash)',
                execution_duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::integer,
                updated_at = NOW()
            WHERE
                status = 'running'
                AND executor_type = 'rust'
                AND started_at < NOW() - INTERVAL '1 minute' * $1
            RETURNING id
            "#,
        )
        .bind(stale_threshold_minutes)
        .fetch_all(pool)
        .await?;

        Ok(result.len() as i32)
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
