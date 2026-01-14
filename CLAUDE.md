# CLAUDE.md - Project Style Guidelines

> "We believe in the extraordinary capacity of human beings—to think, to create, to solve. But that capacity is wasted when it's spent on repetitive work. Automation should serve human potential, not replace it."
>
> — The Mediar Team

## Design Philosophy

### Why This Aesthetic?
Mediar's interface reflects our belief in **clarity over decoration**, **function over form**, and **human potential over algorithmic noise**. We use black and white not as a limitation, but as a lens—focusing attention on what matters: the work itself.

- **Black & White = Universal**: Works for colorblind users, prints perfectly, translates across cultures
- **Animation = Life**: Movement indicates activity, progress, and system health
- **Typography = Hierarchy**: Weight and size communicate importance, not color
- **Minimalism = Respect**: We respect your time by removing visual clutter

### Inspiration
We draw from products that prioritize **speed and clarity**:
- **Linear**: Fast, keyboard-driven, minimal visual noise
- **Stripe Dashboard**: Data-dense yet scannable, excellent use of whitespace
- **Notion**: Smooth animations, clear hierarchy, feels alive but not distracting
- **Apple HIG**: Consistent, predictable, respects platform conventions

**Key principle:** Every pixel should earn its place. If it doesn't inform or delight, remove it.

---

## Architecture Context

### Workflow System (GitHub-First)
- **Workflows stored in GitHub**: `mediar-ai/workflows` repo as source of truth
- **Folder naming**: Human-readable (e.g., `onedriveautomation/workflow.yaml`)
- **Bidirectional sync**: UI creates workflows → pushes to GitHub → webhook syncs back
- **Modal executor**: Loads workflows from GitHub first, database fallback (requires `GITHUB_TOKEN` secret)
- **Database column**: `github_folder` maps folder name to workflow ID

### Modal Deployment
- **Encoding fix**: Use `export PYTHONIOENCODING=utf-8 && modal deploy` on Windows
- **Required secrets**: `supabase-secret`, `custom-secret`, `github-token`
- **Loading priority**: GitHub repo → DB YAML → DB JSONB (legacy)

### Environment Variables
- **Vercel**: `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET` for workflow sync
- **Modal**: Same secrets via `modal secret create`
- **Webhook endpoint**: `/api/webhooks/github` receives push events

## UI/UX Design Principles

### Color Scheme: Black & White Minimalism
- **Primary colors**: Black (#000) and White (#FFF) only
- **Accent colors**: Use gray shades sparingly (#333, #666, #999, #CCC, #F9FAFB for bg-gray-50)
- **NO COLOR CODING**: Avoid red, green, yellow, blue, orange for status indicators
- **Status differentiation**: Use borders, text weight, border styles (dashed/solid), and animations instead of colors
- **Exception**: Red (#DC2626) only for destructive actions (delete, cancel) - use sparingly

**Rationale:** Color-coding fails for 8% of men (colorblindness), doesn't print well, and creates visual noise. Motion and typography are more accessible and elegant.

### Component Styling

#### Buttons
- Primary action: `bg-black text-white hover:bg-gray-800`
- Secondary action: `bg-white text-black border-2 border-black hover:bg-black hover:text-white`
- Icon button: `border border-black hover:bg-black hover:text-white`
- Disabled: `bg-gray-200 text-gray-500 border-2 border-gray-400`
- Destructive (rarely): `hover:bg-red-600 hover:text-white hover:border-red-600`
- Keyboard shortcuts: `<kbd className="ml-2 px-1.5 py-0.5 text-xs bg-white text-black rounded font-mono">N</kbd>`

#### Status Badges
**Reference:** `src/components/ui/animated-badge.tsx`

```
- Active/Running: bg-black text-white border-2 border-black + animate-pulse dot
- Success/Completed: bg-white text-black border-2 border-black + static dot
- Error/Failed: bg-black text-white border-2 border-black font-bold + static dot
- Pending/Queued: bg-gray-100 text-gray-800 border-2 border-dashed border-gray-400 + animate-ping dot
- Paused: bg-gray-200 text-gray-800 border-2 border-gray-400 + static dot
- Disabled: bg-gray-200 text-gray-500 border border-gray-300
```

**Pattern:** Status = border style + animation, not color
- Solid border = stable state
- Dashed border = waiting/queued
- Pulsing dot = actively running
- Ping animation = queued/waiting

#### Forms & Inputs
- All inputs: `border-2 border-black focus:outline-none focus:ring-2 focus:ring-black font-mono`
- Placeholders should be descriptive
- Group related inputs with proper spacing

#### Cards & Containers
- Standard card: `border-2 border-black bg-white`
- Card header: `bg-black text-white p-4` with `font-mono font-bold` title
- Nested sections: `bg-gray-50 border border-gray-200`
- Modals: `border-2 border-black` with sticky header
- Tables: `divide-y divide-gray-200` with `bg-gray-50` header

#### Layout Patterns
- **Tabs**: Connected rectangles with active tab `bg-black text-white`
- **Sidebar**: Collapsible with icons, uses localStorage for persistence
- **Modals**: Fixed overlay with `bg-black bg-opacity-50` backdrop
- **Page headers**: Large title with icon, subtitle in gray-600

### Typography
- Page titles: `text-3xl font-mono font-bold`
- Section headers: `font-mono font-bold uppercase`
- Labels: `font-mono text-xs text-gray-600 uppercase`
- Body text: `text-black` (use `text-gray-600` for secondary)
- Technical content: Always `font-mono` (IDs, emails, code)
- Error messages: Display in bordered boxes, not colored text

### Visual Hierarchy
- Use **border thickness** to show importance (border, border-2, border-4)
- Use **font weight** for emphasis (normal, bold)
- Use **spacing** generously (p-4, p-6, p-8)
- Use **UPPERCASE** for labels and important buttons
- Icons should be 4-6 in size, consistent throughout

### Animation Guidelines

**Philosophy:** Animations should feel **fast, purposeful, and alive**—like Notion's smooth transitions or Linear's snappy interactions.

#### Core Animation Patterns

1. **Loading States** (system is working)
   ```tsx
   // Spinner: Fast rotation, black border
   <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
   // OR with icon
   <Loader2 className="w-4 h-4 animate-spin" />
   ```

2. **Live/Active States** (data is updating in real-time)
   ```tsx
   // Pulsing badge for running workflows/executions
   <Badge className="bg-black text-white animate-pulse">RUNNING</Badge>

   // Pulsing dot for active status
   <span className="animate-ping absolute h-2 w-2 bg-black rounded-full opacity-75" />
   <span className="relative h-2 w-2 bg-black rounded-full" /> {/* Static dot beneath */}
   ```

3. **Queued/Waiting States** (system will act soon)
   ```tsx
   // Dashed border + ping animation
   <div className="border-2 border-dashed border-gray-400 bg-gray-100">
     <span className="animate-ping h-2 w-2 bg-gray-500 rounded-full" />
   </div>
   ```

4. **Modal/Dropdown Transitions** (UI appearing/disappearing)
   ```tsx
   // Radix UI patterns - smooth fade + zoom
   data-[state=open]:animate-in
   data-[state=closed]:animate-out
   fade-in-0 fade-out-0
   zoom-in-95 zoom-out-95
   duration-200
   ```

5. **Hover States** (interactive elements)
   ```tsx
   // Invert colors - black becomes white, white becomes black
   <Button className="bg-black text-white hover:bg-white hover:text-black transition-colors duration-150" />
   ```

#### Animation Speed Guidelines
- **Instant feedback**: 0-150ms (hover states, button presses)
- **Quick transitions**: 150-250ms (modal open/close, dropdowns)
- **Noticeable but smooth**: 300-500ms (page transitions, loading states)
- **Never**: 500ms+ (feels sluggish)

#### What NOT to Animate
- ❌ Text appearing (hard to read)
- ❌ Layout shifts (jarring)
- ❌ Multiple elements at once (overwhelming)
- ❌ Infinite animations without purpose (distracting)

**Reference:** See `src/components/ui/animated-badge.tsx` for the canonical animation patterns.

### Interaction Patterns
- Hover states should invert colors (black ↔ white transition)
- Active states use `animate-pulse` for live data
- Focus states use `ring-2 ring-black`
- Confirmations: Use browser confirm() for destructive actions
- Loading: Simple spinner with "Loading..." text
- Empty states: Centered icon with descriptive text

## Code Style Guidelines

### Component Development
- Keep components minimal and focused
- Prefer inline editing over modal dialogs when possible
- Use monospace fonts for technical content (IDs, code, statuses)

### Error Handling
- Display errors inline when possible
- Use toast notifications instead of browser alerts
- Provide actionable error messages with debugging info

### Email Templates
- Keep emails clean and professional
- Use black/white theme consistent with app
- Include direct action links to relevant pages
- Provide comprehensive debugging information for errors

## Notification System Design

### Alert Emails Should Include:
1. Clear error message with context
2. Direct links to failed workflow/execution
3. Debug information (IP, user agent, parameters)
4. Stack traces when available
5. Unique alert ID for tracking
6. Timestamp with timezone

### Alert Configuration UI:
- Simple toggle switches
- Monospace font for technical fields
- Black/white theme throughout
- Clear SAVE/CLOSE actions
- Toast notifications for feedback

## Testing Philosophy - CRITICAL

**⚠️ ALWAYS test your own implementations - NEVER ask the user to test for you**

### Test-Driven Development (TDD) - MANDATORY
1. **Write tests FIRST**, then implement the feature
2. **Test EVERYTHING** - especially complex logic with edge cases, error conditions, happy paths
3. **Verify your work** by running tests before declaring completion
4. **Create automated tests** whenever possible instead of manual verification
5. **Use available test commands**:
   - `bun run test` - Run all tests
   - `bun run test:watch` - Watch mode for rapid iteration
   - `npm run build` - Verify build succeeds

### Self-Testing Requirements - NON-NEGOTIABLE
- **ALL features**: Write automated tests (unit, integration, or E2E)
- **Complex features**: Write unit tests for business logic BEFORE implementation
- **API/Route changes**: Write integration tests AND manual API tests
- **Bug fixes**: Add regression test that would have caught the bug
- **Before finishing**: Run ALL relevant tests and verify they pass
- **Build verification**: ALWAYS run `npm run build` and ensure no errors

### Testing Strategies - Choose the Right Approach
- **Unit tests**: Test individual functions/methods in isolation (preferred for pure logic)
- **Integration tests**: Test component interactions and API routes
- **API tests**: For backend routes, create test scripts that hit the endpoint with real data
  - Example: Create a `test-*.js` script that makes actual HTTP requests
  - Verify response codes, error handling, edge cases
  - Place scripts in `local-scripts/` (never root), clean up after use
- **E2E tests**: Use Terminator MCP commands to test full workflows
- **Manual verification**: For UI changes, use `npm run dev` to verify visually (LAST RESORT)

### How to Test Complex Features

#### 1. Backend/API Changes
```bash
# Create a test script
cat > test-my-feature.js << 'EOF'
#!/usr/bin/env node
// Test with real HTTP requests
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

const response = await fetch('http://localhost:3000/api/my-endpoint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_PASSWORD}`
  },
  body: JSON.stringify({ test: 'data' })
});

console.log('Status:', response.status);
console.log('Body:', await response.json());
// Verify edge cases, error handling, etc.
EOF

# Run dev server in background
npm run dev &
DEV_PID=$!

# Wait for server to start
sleep 10

# Run test
node test-my-feature.js

# Clean up
kill $DEV_PID
rm test-my-feature.js
```

#### 2. Complex Logic/Utilities
```typescript
// ALWAYS write tests BEFORE implementation
describe('myComplexFunction', () => {
  it('should handle edge case X', () => {
    expect(myComplexFunction(edgeCaseInput)).toBe(expected);
  });

  it('should throw error on invalid input', () => {
    expect(() => myComplexFunction(invalid)).toThrow();
  });
});
```

#### 3. Test as Much as Possible
- **Don't assume it works** - verify with tests
- **Don't rely on "it should work"** - prove it with tests
- **Don't skip tests because it's "simple"** - simple code can have bugs
- **Don't ask user to test** - YOU are the developer, YOU test it

**NEVER say "please test this" or "let me know if it works" - TEST IT YOURSELF FIRST**

**If you can't write an automated test, write a manual test script and run it**

## Testing & Deployment

### Pre-Push Checklist
**IMPORTANT: Always verify before pushing to main:**
1. Run `npm run build` to ensure Next.js builds successfully
2. Check for any TypeScript errors or ESLint warnings that will fail Vercel deployment
3. Fix all build errors before committing - Vercel deployments will fail if the build fails
4. Common issues to check:
   - Unused variables (prefix with `_` if intentionally unused)
   - Missing imports or undefined variables
   - useSearchParams() must be wrapped in Suspense boundary
   - TypeScript type errors
   - **Next.js 15 API Routes**: `params` must be typed as `Promise` and awaited
5. If build succeeds locally, it should deploy successfully on Vercel

### Next.js 15 API Route Params (CRITICAL)
**IMPORTANT: Route params are now async in Next.js 15**

❌ **WRONG (Next.js 14 style):**
```typescript
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;  // ERROR: params is not awaited
  // ...
}
```

✅ **CORRECT (Next.js 15 style):**
```typescript
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;  // Must await params
  // ...
}
```

**This applies to ALL dynamic route parameters:**
- `[id]` → `params: Promise<{ id: string }>`
- `[userId]/[sessionId]` → `params: Promise<{ userId: string; sessionId: string }>`
- Any nested dynamic segments must use Promise type and await

### Modal Deployment (Python Executor)
- **Windows encoding fix**: If you encounter encoding errors when deploying Modal apps on Windows:
  ```bash
  export PYTHONIOENCODING=utf-8 && modal deploy modal_apps/workflow_executor.py
  ```
- This fixes the "'charmap' codec can't encode character" error
- The issue occurs when Modal CLI tries to display Unicode characters (✓) on Windows

### Rust Executor Deployment (Azure Container Instances)
- **Automatic deployment**: Push changes to `rust-executor/**` on main branch → GitHub Actions auto-deploys
- **Manual deployment**: Run `npm run deploy:rust` (dev) or `npm run deploy:rust:prod` (production)
- **From rust-executor directory**: Run `./deploy.sh` (dev) or `./deploy.sh prod` (production)
- **Deployment time**: ~3-5 minutes (automatic), ~2-3 minutes (manual)
- **First-time setup**: Add `AZURE_CREDENTIALS` secret to GitHub (see `rust-executor/QUICK_DEPLOY.md`)
- **Monitoring**:
  - Health: `http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health`
  - Queue: `http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/queue/status`
  - Logs: `az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg --follow`
- **Executor selection**: Mediar team can choose Python or Rust executor in batch test dialog (default: Python)
- **OpenTelemetry**: Rust executor sends traces to centralized OTLP collector
  - Service name: `mediar-workflow-executor-rust`
  - Collector endpoint: `otel-collector-mcp-s3-mount-test.eastus.azurecontainer.io:4318`
  - Backend: ClickHouse Cloud (same as MCP agents)
  - Enable: Set `OTEL_SDK_ENABLED=true` (auto-configured in deployment)
  - Resource attributes: `deployment.environment`, `host.name`, `container.name`, `azure.resource_group`

## Observability & Monitoring

### OpenTelemetry Architecture
All infrastructure components send telemetry to a **centralized OTLP collector** backed by **ClickHouse Cloud**:

**Components sending telemetry:**
- **MCP Windows VMs** (terminator-mcp-agent): Service name `mcp-vm-agent`
  - Differentiated by `host.name`, `vm_name`, `resource_group`, `customer`, `organization_id`
- **Rust Executor** (Azure ACI): Service name `mediar-workflow-executor-rust`
  - Differentiated by `deployment.environment`, `container.name`, `azure.resource_group`
  - **NOTE**: In ClickHouse, `host.name` = `SandboxHost-*` is the **Rust Executor** (NOT Modal/Python)

**Collector infrastructure:**
- **Endpoint**: `http://otel-collector-mcp-s3-mount-test.eastus.azurecontainer.io:4318`
- **Protocol**: OTLP/HTTP (port 4318 for traces and logs)
- **Backend**: ClickHouse Cloud (us-west-2) - columnar database optimized for observability
- **Batch processing**: 1024 events per batch, 10s timeout
- **Health check**: `http://4.157.190.55:13133/`

**Querying telemetry (ClickHouse):**
```sql
-- All rust-executor traces
SELECT * FROM otel_traces
WHERE ServiceName = 'mediar-workflow-executor-rust'

-- All MCP agent traces
SELECT * FROM otel_traces
WHERE ServiceName = 'mcp-vm-agent'

-- Specific VM
SELECT * FROM otel_traces
WHERE ServiceName = 'mcp-vm-agent'
  AND ResourceAttributes['host.name'] = 'vm1'

-- End-to-end workflow execution
SELECT * FROM otel_traces
WHERE ServiceName IN ('mediar-workflow-executor-rust', 'mcp-vm-agent')
ORDER BY Timestamp
```

**Environment variables (auto-configured in deployment):**
- `OTEL_SDK_ENABLED=true` - Enable OpenTelemetry
- `OTEL_EXPORTER_OTLP_ENDPOINT` - Collector URL
- `ENVIRONMENT` - Deployment environment (dev/staging/prod)
- `AZURE_CONTAINER_NAME` - Container instance name
- `AZURE_RESOURCE_GROUP` - Azure resource group

### Environment Variables
- Use Vercel CLI for production deployments: `npx vercel env add`
- Keep email sender addresses simple (no angle brackets in env vars)
- Always trim whitespace from environment variables

### Git Commits
- Use conventional commit format (feat:, fix:, style:, etc.)
- Keep commits focused and atomic
- Include clear descriptions of UI/UX changes

## Infrastructure & Deployment - CRITICAL LESSONS

### 1. Verify Infrastructure Layers Work
Build completes ≠ everything works. Check logs: rclone mount logs, service health endpoints, storage connectivity before declaring success.

### 2. GitHub Actions Secrets Require Explicit Mapping
Secret names ≠ environment variable names. Must map: `secrets.SUPABASE_S3_ACCESS_KEY` → `S3_ACCESS_KEY` in workflow env vars.

### 3. Windows Error Codes Quick Reference
- `os error 5`: Cross-process permissions (fix: `--network-mode`)
- `os error 1117`: Mount exists but broken (check storage logs/credentials)
- `HTTP 403 Missing signature`: S3 credentials missing

### 4. Windows VM Boot Time: 10-15 Minutes
Don't test immediately after `terraform apply`. Wait for boot + auto-logon + services. Health endpoint responding ≠ all services ready.

### 5. Use Auto-Detection for Resources (Docker-style)
Query for latest image dynamically instead of hardcoding versions. Terraform auto-uses newest build without manual updates.

## Important Notes
- User prefers simplicity over complexity
- Mathematical, clean aesthetic is priority
- Avoid unnecessary colors - black & white is sufficient
- Keep all styling consistent across the application
- Production emails must be professional and customer-ready



ALWAYS RUN ON VM 22 and not 6


  "id": 22,
  "name": "ExampleClient infra v2",
  "status": "active",
  "health_status": "healthy"
}
{
  "id": 6,
  "name": "ExampleClient OneDrive to SAP",
  "status": "active",
  "health_status": "healthy"
}


