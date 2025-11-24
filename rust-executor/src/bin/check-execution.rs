use anyhow::Result;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<()> {
    let database_url = std::env::var("DATABASE_URL")?;
    
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    
    let row = sqlx::query!(
        r#"
        SELECT 
            id, 
            workflow_id, 
            status as "status: String",
            error_message,
            created_at,
            updated_at
        FROM workflow_executions 
        WHERE status = 'running' 
        ORDER BY created_at DESC 
        LIMIT 1
        "#
    )
    .fetch_optional(&pool)
    .await?;
    
    if let Some(exec) = row {
        println!("Running Execution:");
        println!("  ID: {}", exec.id);
        println!("  Workflow ID: {:?}", exec.workflow_id);
        println!("  Status: {}", exec.status);
        println!("  Error: {:?}", exec.error_message);
        println!("  Created: {:?}", exec.created_at);
        println!("  Updated: {:?}", exec.updated_at);
        
        if let Some(wf_id) = exec.workflow_id {
            let workflow = sqlx::query!(
                "SELECT name, uuid FROM deployed_workflows WHERE id = $1",
                wf_id
            )
            .fetch_one(&pool)
            .await?;
            
            println!("\nWorkflow:");
            println!("  Name: {}", workflow.name);
            println!("  UUID: {:?}", workflow.uuid);
        }
    } else {
        println!("No running executions found");
    }
    
    Ok(())
}
