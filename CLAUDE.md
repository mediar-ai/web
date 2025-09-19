# CLAUDE.md - Project Style Guidelines

## UI/UX Design Principles

### Color Scheme: Black & White Minimalism
- **Primary colors**: Black (#000) and White (#FFF) only
- **Accent colors**: Use gray shades sparingly (#333, #666, #999, #CCC)
- **NO COLOR CODING**: Avoid red, green, yellow, blue, orange for status indicators
- **Status differentiation**: Use borders, text weight, and animations instead of colors

### Component Styling

#### Buttons
- Primary action: `bg-black text-white hover:bg-gray-800`
- Secondary action: `bg-white text-black border-2 border-black hover:bg-black hover:text-white`
- Disabled: `bg-gray-200 text-gray-500`

#### Status Badges
```
- Active/Running: bg-black text-white (optional: animate-pulse)
- Success/Completed: bg-white text-black border-2 border-black
- Error/Failed: bg-black text-white font-bold
- Pending/Queued: bg-white text-black border border-gray-400
- Warning: bg-gray-200 text-black border border-black
```

#### Forms & Inputs
- All inputs: `border-2 border-black focus:outline-none focus:ring-2 focus:ring-black`
- Monospace font for technical content: `font-mono`

#### Cards & Containers
- Standard card: `border border-black bg-white`
- Emphasized card: `border-2 border-black`
- Nested/Secondary: `bg-gray-50 border border-gray-400`

### Typography
- Headers: `font-mono font-bold text-black`
- Body text: `text-black` (use `text-gray-600` for secondary)
- Error messages: Display in boxes with borders, not colored text
- Use UPPERCASE sparingly for emphasis (e.g., status badges)

### Visual Hierarchy
- Use **border thickness** to show importance (1px, 2px, 4px)
- Use **font weight** for emphasis (normal, medium, bold)
- Use **spacing** and **size** to create hierarchy
- Use **animations** sparingly (pulse for active states, transitions on hover)

### Interaction Patterns
- Hover states should invert colors (black ↔ white)
- Active states use `animate-pulse` or similar subtle animations
- Focus states use black ring/outline
- Avoid browser alerts - use toast notifications or inline messages

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