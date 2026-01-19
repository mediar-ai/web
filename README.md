# Mediar

<img width="1024" height="559" alt="Mediar Desktop App" src="https://github.com/user-attachments/assets/c8a9bc75-7241-4fc6-955b-6cd2166a3f05" />

Mediar is an open-source workflow automation platform that combines desktop automation with AI capabilities.

## Project Structure

This is a monorepo containing:

- **`apps/web`** - Next.js 15 web application (dashboard, API)
- **`apps/desktop`** - Tauri desktop app (React frontend + Rust backend)
- **`packages/infra`** - Azure/telemetry utilities
- **`crates/executor`** - Rust workflow executor service
- **`modal_apps`** - Python Modal.com serverless functions

## Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [Rust](https://www.rust-lang.org/tools/install) (for desktop app)
- [Node.js](https://nodejs.org/) (v20+)

## Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/mediar-ai/mediar-web-app-workspace.git
   cd mediar-web-app-workspace
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   # Copy example env files
   cp .env.example apps/web/.env.local
   cp apps/desktop/.env.example apps/desktop/.env
   cp crates/executor/.env.example crates/executor/.env
   ```

4. **Run development servers**
   ```bash
   # Run all packages
   bun run dev

   # Or run individually
   bun run dev:web        # Web app only
   bun run dev:desktop    # Desktop app only
   ```

## Available Commands

```bash
bun run dev            # Start all dev servers
bun run dev:web        # Start web app
bun run dev:desktop    # Start desktop app (Tauri)
bun run build          # Build all packages
bun run type-check     # TypeScript check all packages
bun run test           # Run all tests
bun run test:desktop   # Desktop tests (Vitest + Cargo)
```

## Environment Variables

### Web App (`apps/web/.env.local`)
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `DATABASE_URL` - PostgreSQL connection string
- `MCP_AUTH_TOKEN` - Bearer token for MCP VM endpoints
- `WORKING_VM_IP` - Seed IP for admin repair flow
- `VM_ADMIN_HOST` - Host for VM admin tunnel
- `VM_ADMIN_PORT` - Port for VM admin tunnel
- `VM_SERVICE_ENDPOINT` - Tunnel endpoint for VM admin service
- `VM_MCP_ENDPOINT` - Tunnel endpoint for MCP service
- `CLUSTER_FALLBACK_ENDPOINTS` - JSON array of MCP endpoints to try

### Desktop App (`apps/desktop/.env`)
- `VITE_API_BASE_URL` - Backend API URL
- `GEMINI_API_KEY` - Google Gemini API key (for AI features)
- `VITE_ANTHROPIC_API_KEY` - Anthropic API key (for chat)
- `VM_USERNAME` - VM username for dev tooling
- `VM_PASSWORD` - VM password for dev tooling
- `VNC_PASSWORD` - VNC password for dev tooling
- `NEXT_PUBLIC_VNC_PASSWORD` - VNC password for vm-dashboard UI

### Executor (`crates/executor/.env`)
- `MCP_ENDPOINT` - Default MCP endpoint for local runs
- `MCP_AUTH_TOKEN` - Bearer token for MCP endpoints

See `.env.example` files in each app for all available options.

## Architecture

```
User -> Desktop App -> Web API -> Workflow Executor -> MCP VMs -> Supabase
```

- **Desktop App**: Captures user actions, manages local workflows
- **Web API**: Authentication, workflow storage, job queuing
- **Workflow Executor**: Runs workflow steps on remote VMs
- **MCP VMs**: Azure Windows VMs with terminator-mcp-agent for UI automation
- **Supabase**: Database for workflows, executions, and user data

## Deployment

### Rust Executor (Google Cloud Run)
```bash
bun run deploy:rust      # Deploy to dev
bun run deploy:rust:prod # Deploy to production
```

### Modal Apps
```bash
export PYTHONIOENCODING=utf-8
modal deploy modal_apps/workflow_executor.py
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) for details.
