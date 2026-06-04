<img width="1024" height="559" alt="Mediar" src="https://github.com/user-attachments/assets/c8a9bc75-7241-4fc6-955b-6cd2166a3f05" />

# Mediar

Capture a browser workflow once, then run it on demand against cloud VMs. Mediar records what you do in the browser, turns it into a reusable workflow, and executes it headlessly through MCP-driven virtual machines.

Live app: [app.mediar.ai](https://app.mediar.ai)

## Monorepo layout

| Path | What it is |
|------|------------|
| `apps/web` | Next.js 15 web app (dashboard, auth, billing, workflow management) |
| `apps/desktop` | Tauri desktop app (React + Rust) for capturing workflows |
| `crates/executor` | Rust workflow executor |
| `modal_apps` | Python executor deployed on [Modal](https://modal.com) |
| `packages/infra` | Azure / telemetry utilities |
| `supabase` | Database schema and migrations |

## Architecture

```
GitHub workflows repo  →  Modal / Rust executor  →  MCP VMs  →  Supabase
```

Workflows are stored in a repo, dispatched to the Modal or Rust executor, run on MCP-controlled VMs, and results are persisted to Supabase.

## Quick start

Requires [Bun](https://bun.sh) and Node 20 (see `.nvmrc`).

```bash
bun install
cp .env.example .env.local   # fill in your own keys
bun run dev                  # run all packages
```

Useful scripts:

```bash
bun run dev:web        # web app only
bun run dev:desktop    # desktop app only (Tauri)
bun run build          # build everything
bun run type-check     # typecheck all packages
bun run test           # run all tests
```

## Deploy

```bash
# Python executor (Modal)
export PYTHONIOENCODING=utf-8 && modal deploy modal_apps/workflow_executor.py

# Rust executor
bun run deploy:rust        # dev
bun run deploy:rust:prod   # prod
```

## Contributing

Issues and pull requests are welcome. Run `bun run type-check` and `bun run test` before opening a PR.

## License

[MIT](./LICENSE)
