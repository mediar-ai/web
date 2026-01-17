# Mediar Web Monorepo

## Structure
- `apps/web` - Next.js 15 web app
- `apps/desktop` - Tauri desktop app (React + Rust)
- `packages/infra` - Azure/telemetry utilities
- `crates/executor` - Rust workflow executor

## Commands
```bash
bun run dev            # all packages
bun run dev:web        # just web
bun run dev:desktop    # just desktop (Tauri)
bun run build          # build all
bun run build:web      # build web only
bun run type-check     # typecheck all
bun run test           # test all
bun run clean          # clean build artifacts
```

## Deploy
```bash
# Modal (Python executor)
export PYTHONIOENCODING=utf-8 && modal deploy modal_apps/workflow_executor.py

# Rust executor
bun run deploy:rust      # dev
bun run deploy:rust:prod # prod
```

## Critical Gotchas

### Next.js 15 async params
```typescript
// WRONG
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { id } = params; // ERROR
}

// CORRECT
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // Must await
}
```

## Style
Black & white minimal. No color coding for status. Look at existing components.

## Architecture
GitHub workflows repo → Modal/Rust executor → MCP VMs → Supabase
