# Rust Workflow Executor

A high-performance workflow execution engine built in Rust, designed to replace the Python Modal executor. This service provides REST API endpoints for workflow management and execution using MCP (Model Context Protocol) for browser automation and other tools.

## Features

- **Workflow Execution**: Execute complex multi-step workflows with MCP tools
- **Screenshot Upload**: Automatic upload of workflow screenshots to Supabase Storage
- **GitHub Integration**: Load workflows directly from GitHub repositories
- **Queue Processing**: Background job processing with machine-specific locking
- **RMCP Integration**: Full MCP client support via RMCP library
- **Error Handling**: Sophisticated error strategies (stop, continue, retry, fallback)
- **Docker Support**: Production-ready Docker containers
- **PostgreSQL Backend**: Robust database for workflow and execution management
- **Comprehensive Testing**: Unit tests with high coverage

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│   REST API      │────▶│   Workflow   │────▶│   MCP       │
│   (Axum)        │     │   Service    │     │   Client    │
└─────────────────┘     └──────────────┘     └─────────────┘
        │                       │                     │
        ▼                       ▼                     ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│   PostgreSQL    │     │   GitHub     │     │   MCP       │
│   Database      │     │   Loader     │     │   Server    │
└─────────────────┘     └──────────────┘     └─────────────┘
```

## 🚀 One-Line Deployment to Azure

```bash
./deploy.sh
```

That's it! Get a public API in 5 minutes. See [DEPLOY.md](DEPLOY.md) for details.

---

## Quick Start

### Using Docker Compose (Recommended)

1. Clone the repository and navigate to the rust-executor folder
2. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
3. Configure your environment variables in `.env`
4. Start the services:
   ```bash
   docker-compose up -d
   ```

### Local Development

1. Install Rust (1.83 or later)
2. Install PostgreSQL
3. Set environment variables:
   ```bash
   export DATABASE_URL=postgresql://postgres:password@localhost/mediar_workflows
   export MCP_ENDPOINT=http://localhost:3000
   export GITHUB_TOKEN=your_github_token
   ```
4. Build and run:
   ```bash
   cargo build --release
   cargo run
   ```

## API Endpoints

### Health Check
```http
GET /api/v1/health
```

### List Workflows
```http
GET /api/v1/workflows
```

### Get Workflow
```http
GET /api/v1/workflows/{id}
```

### Execute Workflow
```http
POST /api/v1/executions
Content-Type: application/json

{
  "workflow_id": "uuid",
  "execution_params": {},
  "client_id": "optional-client-id",
  "version_number": "1.0.0",
  "mcp_endpoint": "http://localhost:3000"
}
```

### Get Execution Status
```http
GET /api/v1/executions/{id}
```

### Cancel Execution
```http
POST /api/v1/executions/{id}/cancel
```

### Queue Status
```http
GET /api/v1/queue/status
```

## Workflow Format

Workflows can be defined in YAML or JSON format:

```yaml
steps:
  - id: open_browser
    tool_name: browser_open
    arguments:
      url: https://example.com
  - id: screenshot
    tool_name: take_screenshot
    arguments:
      filename: screenshot.png
    retry_count: 3
    on_error: continue

variables:
  base_url:
    label: Base URL
    default: https://example.com

stop_on_error: false
include_detailed_results: true
```

## Error Strategies

Each workflow step can define an error handling strategy:

- **stop**: Stop workflow execution on error (default)
- **continue**: Continue to the next step despite errors
- **retry**: Retry the step (requires `retry_count`)
- **fallback**: Execute a fallback step (requires `fallback_id`)

## Testing

### Unit Tests

Run unit tests:
```bash
cargo test
```

Run integration tests (requires database):
```bash
cargo test --all --features integration
```

### Local Integration Test with Terminator MCP

Test the full stack locally (Rust executor + Terminator MCP + screenshot upload):

```bash
./scripts/run_integration_test.sh
```

This will:
1. Build the Terminator MCP agent if needed (from `../terminator`)
2. Load environment variables from `.env`
3. Start the MCP server via stdio transport
4. Execute a test workflow with browser automation and screenshot capture
5. Verify screenshots are captured and uploaded (if Supabase is configured)

**Prerequisites:**
- Terminator repository cloned alongside rust-executor: `../terminator`
- Rust toolchain installed
- Chrome browser (for browser automation tests)
- Optional: Supabase credentials in `.env` for upload testing

**What it tests:**
- ✓ MCP client connection via stdio transport
- ✓ Workflow validation and execution
- ✓ Browser automation (navigate, wait, screenshot)
- ✓ Screenshot capture through MCP tools
- ✓ Screenshot upload to Supabase (if configured)
- ✓ Error handling and workflow completion

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `MCP_ENDPOINT` | MCP server URL | http://localhost:3000 |
| `GITHUB_TOKEN` | GitHub personal access token | Optional |
| `GITHUB_REPO` | GitHub repository for workflows | mediar-ai/workflows |
| `SUPABASE_URL` | Supabase project URL for screenshot uploads | Optional |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key for storage access | Optional |
| `PORT` | API server port | 8080 |
| `RUST_LOG` | Log level | info |

### Screenshot Upload Configuration

Screenshots captured during workflow execution are automatically uploaded to Supabase Storage when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured:

- **Storage Path**: `screenshots/{organization_id}/{execution_id}/{filename}`
- **Access**: Signed URLs with 1-hour expiration
- **Fallback**: Public URLs if signed URL generation fails
- **Organization Scoping**: Uses organization_id for multi-tenant security (defaults to system UUID if not available)

## Database Schema

The service expects the following PostgreSQL tables:

- `deployed_workflows_with_sequence`: Workflow definitions
- `workflow_executions`: Execution records and status
- `machine_locks`: Distributed locking for queue processing

## Docker Deployment

Build the Docker image:
```bash
docker build -t workflow-executor .
```

Run the container:
```bash
docker run -p 8080:8080 \
  -e DATABASE_URL=postgresql://postgres:password@host/db \
  -e MCP_ENDPOINT=http://mcp-server:3000 \
  workflow-executor
```

## Performance

- **Concurrent Executions**: Supports multiple parallel workflow executions
- **Async I/O**: Non-blocking operations using Tokio
- **Connection Pooling**: Efficient database connection management
- **Request Caching**: GitHub workflow caching to reduce API calls

## Monitoring

The service exposes detailed logs via the `RUST_LOG` environment variable:

```bash
# Debug level logging
RUST_LOG=debug cargo run

# Trace level for specific modules
RUST_LOG=workflow_executor=trace,tower_http=debug cargo run
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT# Debug logging enabled for step execution
# Testing cached build Mon, Nov 24, 2025 10:45:48 AM
