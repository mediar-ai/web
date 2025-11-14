use anyhow::{Context, Result};
use serde_json::Value;
use sqlx::Row;
use tracing::{error, info, warn};

use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::mcp::{McpClient, WorkflowExecutor};
use crate::models::{
    ExecutionRequest, ExecutionResponse, ExecutionStatus, Workflow, WorkflowExecution,
    WorkflowSequence,
};
use crate::services::GitHubLoader;

pub struct WorkflowService {
    db_pool: DatabasePool,
    github_loader: GitHubLoader,
}

impl WorkflowService {
    pub fn new(db_pool: DatabasePool) -> Self {
        let github_token = std::env::var("GITHUB_TOKEN").ok();
        let github_loader = GitHubLoader::new(github_token);

        Self {
            db_pool,
            github_loader,
        }
    }

    /// Execute a workflow by ID
    pub async fn execute_workflow(&self, request: ExecutionRequest) -> Result<ExecutionResponse> {
        info!(
            "Processing workflow execution request for workflow {}",
            request.workflow_id
        );

        // Get workflow from database
        let workflow = WorkflowQueries::get_workflow(&self.db_pool, request.workflow_id)
            .await?
            .context("Workflow not found")?;

        // Check if workflow is deployed
        if workflow.status != crate::models::WorkflowStatus::Deployed {
            return Ok(ExecutionResponse {
                execution_id: 0, // Will not be used since this is an error response
                status: ExecutionStatus::Failed,
                message: "Workflow is not deployed".to_string(),
                result: None,
                error: Some("Workflow must be deployed to execute".to_string()),
                started_at: None,
                completed_at: None,
                logs: None,
            });
        }

        // Load workflow sequence
        let sequence = self
            .load_workflow_sequence(&workflow, request.execution_params.as_ref())
            .await?;
        
        // DEBUG: Log loaded sequence
        error!("DEBUG - Loaded sequence: {:?}", sequence);

        // Validate sequence
        sequence
            .validate()
            .context("Workflow sequence validation failed")?;

        // Create execution record
        let execution_id = WorkflowQueries::create_execution(
            &self.db_pool,
            request.workflow_id,
            request.client_id.clone(),
            request.execution_params.clone(),
        )
        .await?;

        info!(
            "Created execution {} for workflow {}",
            execution_id, request.workflow_id
        );

        // Create MCP client
        let mcp_client = McpClient::from_url(request.mcp_endpoint.clone());

        // Execute workflow
        // TODO: Get organization_id from workflow or request when available
        let executor = WorkflowExecutor::new(mcp_client, sequence, execution_id, None);
        let result = executor.execute().await;

        // Update execution status
        match &result {
            Ok(workflow_result) => {
                WorkflowQueries::update_execution_status(
                    &self.db_pool,
                    execution_id,
                    if workflow_result.success {
                        ExecutionStatus::Completed
                    } else {
                        ExecutionStatus::Failed
                    },
                    workflow_result.error.clone(),
                    Some(serde_json::to_value(&workflow_result.step_results).ok().unwrap_or(serde_json::json!([]))),
                    workflow_result.data.clone(),
                )
                .await?;
                Ok(ExecutionResponse {
                    execution_id,
                    status: if workflow_result.success {
                        ExecutionStatus::Completed
                    } else {
                        ExecutionStatus::Failed
                    },
                    message: workflow_result.message.clone(),
                    result: workflow_result.data.clone(),
                    error: workflow_result.error.clone(),
                    started_at: Some(chrono::Utc::now()),
                    completed_at: Some(chrono::Utc::now()),
                    logs: None,
                })
            }
            Err(e) => {
                error!("Workflow execution failed: {}", e);

                WorkflowQueries::update_execution_status(
                    &self.db_pool,
                    execution_id,
                    ExecutionStatus::Failed,
                    Some(e.to_string()),
                    None,
                    None,
                )
                .await?;

                Ok(ExecutionResponse {
                    execution_id,
                    status: ExecutionStatus::Failed,
                    message: "Workflow execution failed".to_string(),
                    result: None,
                    error: Some(e.to_string()),
                    started_at: Some(chrono::Utc::now()),
                    completed_at: Some(chrono::Utc::now()),
                    logs: None,
                })
            }
        }
    }

    /// Load workflow sequence from GitHub or database
    async fn load_workflow_sequence(
        &self,
        workflow: &Workflow,
        execution_params: Option<&Value>,
    ) -> Result<WorkflowSequence> {
        // Check if this is a TypeScript workflow
        if workflow.preferred_format.as_deref() == Some("typescript") {
            info!("Detected TypeScript workflow, building file:// URL execution");
            return self.build_typescript_workflow_sequence(workflow, execution_params);
        }

        // Priority 1: Load from GitHub if configured
        if let Some(github_folder) = &workflow.github_folder {
            let github_ref = workflow.github_ref.as_deref().unwrap_or("main");

            match self
                .github_loader
                .load_workflow(github_folder, github_ref)
                .await
            {
                Ok(yaml_content) => {
                    info!("Loaded workflow from GitHub: {}", github_folder);
                    return WorkflowSequence::from_yaml(&yaml_content);
                }
                Err(e) => {
                    warn!(
                        "Failed to load from GitHub: {}, falling back to database",
                        e
                    );
                }
            }
        }

        // Priority 2: Use YAML from database
        if let Some(yaml) = &workflow.automation_sequence_yaml {
            if !yaml.is_empty() {
                info!("Loading workflow from database YAML");
                return WorkflowSequence::from_yaml(yaml);
            }
        }

        // Priority 3: Use JSON from database
        if let Some(json) = &workflow.automation_sequence {
            info!("Loading workflow from database JSON");
            return WorkflowSequence::from_value(json.clone());
        }

        anyhow::bail!("No automation sequence found for workflow")
    }

    /// Build a workflow sequence for TypeScript workflows
    /// Creates a special sequence that calls execute_sequence with url parameter
    fn build_typescript_workflow_sequence(
        &self,
        workflow: &Workflow,
        execution_params: Option<&Value>,
    ) -> Result<WorkflowSequence> {
        use crate::models::WorkflowSequence;
        use serde_json::{json, Map, Value};

        // Determine the file path to the TypeScript workflow
        // Assuming files are mounted at /tmp/workflow-files/{workflow_id}/
        let workflow_path = format!("/tmp/workflow-files/{}", workflow.id);

        // Check for terminator.ts in different locations (priority order)
        let possible_paths = vec![
            format!("{}/src/terminator.ts", workflow_path),
            format!("{}/terminator.ts", workflow_path),
            format!("{}/src/workflow.ts", workflow_path),
            format!("{}/workflow.ts", workflow_path),
            format!("{}/src/index.ts", workflow_path),
            format!("{}/index.ts", workflow_path),
        ];

        let file_url = possible_paths
            .into_iter()
            .find(|path| std::path::Path::new(path).exists())
            .map(|path| format!("file://{}", path))
            .unwrap_or_else(|| {
                // Fallback: assume src/terminator.ts (MCP server will handle error if not found)
                format!("file://{}/src/terminator.ts", workflow_path)
            });

        info!("TypeScript workflow URL: {}", file_url);

        // Build arguments object with url parameter
        let mut args = Map::new();
        args.insert("url".to_string(), Value::String(file_url));

        // Add inputs from execution_params if available
        if let Some(params) = execution_params {
            args.insert("inputs".to_string(), params.clone());
        }

        // Build the workflow sequence with a single step that calls execute_sequence
        let yaml_content = json!({
            "steps": [{
                "id": "typescript_execution",
                "tool_name": "execute_sequence",
                "arguments": args,
                "description": format!("Execute TypeScript workflow: {}", workflow.name)
            }],
            "stop_on_error": true,
            "include_detailed_results": true
        });

        WorkflowSequence::from_value(yaml_content)
    }

    /// Get execution status
    pub async fn get_execution(&self, execution_id: i64) -> Result<Option<WorkflowExecution>> {
        let row = sqlx::query(
            r#"
            SELECT
                id, workflow_id, status,
                client_id, execution_params, assigned_machine_id,
                started_at, completed_at, error_message,
                results, execution_logs, total_steps,
                current_step_description, created_at, updated_at
            FROM workflow_executions
            WHERE id = $1
            "#,
        )
        .bind(execution_id)
        .fetch_optional(&self.db_pool)
        .await?;

        if let Some(row) = row {
            Ok(Some(WorkflowExecution {
                id: row.get("id"),
                workflow_id: row.get("workflow_id"),
                status: WorkflowQueries::parse_execution_status(row.get("status")),
                client_id: row.get("client_id"),
                execution_params: row.get("execution_params"),
                machine_id: row.get("assigned_machine_id"),
                mcp_endpoint: None, // Not fetched in this query
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

    /// List workflows
    pub async fn list_workflows(&self) -> Result<Vec<Workflow>> {
        let rows = sqlx::query(
            r#"
            SELECT
                id, name, version, description,
                status, category, github_folder, github_ref,
                preferred_format,
                automation_sequence, automation_sequence_yaml,
                created_at, updated_at
            FROM deployed_workflows_with_sequence
            WHERE status = 'deployed'
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(&self.db_pool)
        .await?;

        let workflows = rows
            .into_iter()
            .map(|row| Workflow {
                id: row.get("id"),
                name: row.get("name"),
                version: row.get("version"),
                description: row.get("description"),
                status: crate::models::WorkflowStatus::Deployed,
                category: row.get("category"),
                github_folder: row.get("github_folder"),
                github_ref: row.get("github_ref"),
                preferred_format: row.get("preferred_format"),
                automation_sequence: row.get("automation_sequence"),
                automation_sequence_yaml: row.get("automation_sequence_yaml"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();

        Ok(workflows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database
    async fn test_workflow_service() {
        let db_pool = crate::db::create_pool("postgresql://test:test@localhost/test")
            .await
            .unwrap();

        let service = WorkflowService::new(db_pool);
        let workflows = service.list_workflows().await;
        assert!(workflows.is_ok());
    }
}
