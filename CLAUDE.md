# CLAUDE.md - Project Style Guidelines

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
- **Status differentiation**: Use borders, text weight, and animations instead of colors
- **Exception**: Red (#DC2626) only for Mediar admin sections and destructive actions

### Component Styling

#### Buttons
- Primary action: `bg-black text-white hover:bg-gray-800`
- Secondary action: `bg-white text-black border-2 border-black hover:bg-black hover:text-white`
- Icon button: `border border-black hover:bg-black hover:text-white`
- Disabled: `bg-gray-200 text-gray-500 border-2 border-gray-400`
- Destructive (rarely): `hover:bg-red-600 hover:text-white hover:border-red-600`
- Keyboard shortcuts: `<kbd className="ml-2 px-1.5 py-0.5 text-xs bg-white text-black rounded font-mono">N</kbd>`

#### Status Badges
```
- Active/Running: bg-black text-white animate-pulse
- Success/Completed: bg-white text-black border-2 border-black
- Error/Failed: bg-black text-white font-bold
- Pending/Queued: bg-yellow-100 text-yellow-800 border border-yellow-300
- Disabled: bg-gray-200 text-gray-800
- Admin/Owner: bg-black text-white (with Crown icon for owners)
```

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
5. If build succeeds locally, it should deploy successfully on Vercel

### Modal Deployment (Windows Encoding Fix)
- If you encounter encoding errors when deploying Modal apps on Windows:
  ```bash
  export PYTHONIOENCODING=utf-8 && modal deploy modal_apps/workflow_executor.py
  ```
- This fixes the "'charmap' codec can't encode character" error
- The issue occurs when Modal CLI tries to display Unicode characters (✓) on Windows

### Environment Variables
- Use Vercel CLI for production deployments: `npx vercel env add`
- Keep email sender addresses simple (no angle brackets in env vars)
- Always trim whitespace from environment variables

### Git Commits
- Use conventional commit format (feat:, fix:, style:, etc.)
- Keep commits focused and atomic
- Include clear descriptions of UI/UX changes

## Important Notes
- User prefers simplicity over complexity
- Mathematical, clean aesthetic is priority
- Avoid unnecessary colors - black & white is sufficient
- Keep all styling consistent across the application
- Production emails must be professional and customer-ready