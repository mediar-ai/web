use axum::{
    Router,
    routing::{get, post},
    extract::{State, Path},
    response::Json,
    http::StatusCode,
};
use serde::Serialize;
use uuid::Uuid;
use sqlx::Row;

use crate::db::DatabasePool;
use crate::models::{ExecutionRequest, ExecutionResponse, Workflow, WorkflowExecution};
use crate::services::WorkflowService;

pub fn routes() -> Router<DatabasePool> {
    Router::new()
        // Health check
        .route("/health", get(health_check))

        // Workflow endpoints
        .route("/workflows", get(list_workflows))
        .route("/workflows/:id", get(get_workflow))

        // Execution endpoints
        .route("/executions", post(create_execution))
        .route("/executions/:id", get(get_execution))
        .route("/executions/:id/cancel", post(cancel_execution))

        // Queue status
        .route("/queue/status", get(queue_status))
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn list_workflows(
    State(db_pool): State<DatabasePool>,
) -> Result<Json<Vec<Workflow>>, (StatusCode, String)> {
    let service = WorkflowService::new(db_pool);

    service.list_workflows()
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_workflow(
    State(db_pool): State<DatabasePool>,
    Path(id): Path<Uuid>,
) -> Result<Json<Workflow>, (StatusCode, String)> {
    let workflow = crate::db::queries::WorkflowQueries::get_workflow(&db_pool, id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match workflow {
        Some(w) => Ok(Json(w)),
        None => Err((StatusCode::NOT_FOUND, "Workflow not found".to_string())),
    }
}

async fn create_execution(
    State(db_pool): State<DatabasePool>,
    Json(request): Json<ExecutionRequest>,
) -> Result<Json<ExecutionResponse>, (StatusCode, String)> {
    let service = WorkflowService::new(db_pool);

    service.execute_workflow(request)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn get_execution(
    State(db_pool): State<DatabasePool>,
    Path(id): Path<Uuid>,
) -> Result<Json<WorkflowExecution>, (StatusCode, String)> {
    let service = WorkflowService::new(db_pool);

    let execution = service.get_execution(id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match execution {
        Some(e) => Ok(Json(e)),
        None => Err((StatusCode::NOT_FOUND, "Execution not found".to_string())),
    }
}

async fn cancel_execution(
    State(db_pool): State<DatabasePool>,
    Path(id): Path<Uuid>,
) -> Result<Json<CancelResponse>, (StatusCode, String)> {
    use crate::db::queries::WorkflowQueries;
    use crate::models::ExecutionStatus;

    WorkflowQueries::update_execution_status(
        &db_pool,
        id,
        ExecutionStatus::Cancelled,
        Some("Cancelled by user".to_string()),
        None,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(CancelResponse {
        success: true,
        message: "Execution cancelled".to_string(),
    }))
}

#[derive(Serialize)]
struct CancelResponse {
    success: bool,
    message: String,
}

#[derive(Serialize)]
struct QueueStatusResponse {
    queued_count: i64,
    running_count: i64,
    failed_count: i64,
    completed_count: i64,
}

async fn queue_status(
    State(db_pool): State<DatabasePool>,
) -> Result<Json<QueueStatusResponse>, (StatusCode, String)> {
    let result = sqlx::query(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE status = 'queued') as queued_count,
            COUNT(*) FILTER (WHERE status = 'running') as running_count,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_count
        FROM workflow_executions
        WHERE created_at > NOW() - INTERVAL '24 hours'
        "#
    )
    .fetch_one(&db_pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(QueueStatusResponse {
        queued_count: result.get::<Option<i64>, _>("queued_count").unwrap_or(0),
        running_count: result.get::<Option<i64>, _>("running_count").unwrap_or(0),
        failed_count: result.get::<Option<i64>, _>("failed_count").unwrap_or(0),
        completed_count: result.get::<Option<i64>, _>("completed_count").unwrap_or(0),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_health_check() {
        let response = health_check().await;
        assert_eq!(response.0.status, "healthy");
    }
}