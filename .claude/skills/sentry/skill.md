---
name: sentry
description: Query Sentry for application errors, issues, and events. Auto-activates when user asks about errors, exceptions, crashes, or debugging production issues. Trigger words: "check sentry", "sentry errors", "production errors", "what's crashing", "error tracking", "show exceptions", "recent errors"
allowed-tools: Bash, Read
---

# Sentry Error Tracking Skill

Query and analyze Sentry issues, events, and error data for debugging production applications.

## ⚠️ CRITICAL SAFETY RULES

**READ OPERATIONS (GET):** ✅ Safe to execute directly
**WRITE OPERATIONS (POST/PUT/DELETE):** ❌ **MUST ask user for explicit confirmation first**

For any modification (resolving issues, updating settings):
1. Show exactly what will change
2. Ask: "This will modify Sentry data. Confirm: yes/no?"
3. Only proceed if user explicitly confirms

---

## Quick Start - Copy-Paste Pattern

**Use this pattern for ALL queries to avoid bash escaping issues:**

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash

# Load credentials from .env.local
if [ -f .env.local ]; then
  SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
  SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')
else
  echo "❌ ERROR: No .env.local found!"
  echo ""
  echo "Please add to .env.local:"
  echo "SENTRY_AUTH_TOKEN=<your-auth-token>"
  echo "SENTRY_ORG=<your-org-slug>"
  echo ""
  echo "To get your auth token:"
  echo "1. Go to https://sentry.io/settings/account/api/auth-tokens/"
  echo "2. Create a new token with: project:read, org:read, event:read"
  exit 1
fi

if [ -z "$SENTRY_AUTH_TOKEN" ] || [ -z "$SENTRY_ORG" ]; then
  echo "❌ ERROR: SENTRY_AUTH_TOKEN or SENTRY_ORG not set in .env.local"
  exit 1
fi

# Your query here
curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?query=is:unresolved&limit=10" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq '.'
EOF
bash /tmp/query_sentry.sh
```

**Environment variables (add to `.env.local`):**
- `SENTRY_AUTH_TOKEN` - API auth token (create at sentry.io/settings/account/api/auth-tokens/)
- `SENTRY_ORG` - Organization slug (from your Sentry URL)

---

## Sentry API Reference

### Key Concepts
- **Organization**: Top-level container (identified by slug, e.g., "mediar-ai")
- **Project**: Application being monitored (e.g., "nextjs-app", "rust-executor")
- **Issue**: Aggregated error (groups similar events)
- **Event**: Single error occurrence

### Base URL
```
https://sentry.io/api/0/
```

---

## Common Queries

### 1. List All Projects

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/projects/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.slug)] \(.name) - \(.platform)"'
EOF
bash /tmp/query_sentry.sh
```

### 2. Recent Unresolved Issues (All Projects)

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?query=is:unresolved&sort=date&limit=15" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.shortId)] \(.title) | \(.count) events | \(.project.slug) | \(.lastSeen)"'
EOF
bash /tmp/query_sentry.sh
```

### 3. Issues for Specific Project

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

PROJECT="nextjs-app"  # Replace with your project slug

curl -s "https://sentry.io/api/0/projects/${SENTRY_ORG}/${PROJECT}/issues/?query=is:unresolved&limit=10" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.shortId)] \(.title) | Events: \(.count) | \(.lastSeen)"'
EOF
bash /tmp/query_sentry.sh
```

### 4. Get Issue Details

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID (e.g., NEXTJS-ABC)

curl -s "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq '{
    id: .shortId,
    title: .title,
    culprit: .culprit,
    count: .count,
    userCount: .userCount,
    firstSeen: .firstSeen,
    lastSeen: .lastSeen,
    status: .status,
    level: .level,
    project: .project.slug
  }'
EOF
bash /tmp/query_sentry.sh
```

### 5. Get Latest Event for Issue (Full Stack Trace)

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s "https://sentry.io/api/0/issues/${ISSUE_ID}/events/latest/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq '{
    eventID: .eventID,
    message: .message,
    timestamp: .dateCreated,
    tags: .tags,
    context: .contexts,
    exception: .entries[] | select(.type == "exception") | .data.values[0] | {
      type: .type,
      value: .value,
      stacktrace: .stacktrace.frames[-5:] | map({file: .filename, line: .lineNo, function: .function})
    }
  }'
EOF
bash /tmp/query_sentry.sh
```

### 6. Search Issues by Error Message

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

SEARCH_TERM="TypeError"  # Replace with error type or message

curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?query=is:unresolved+${SEARCH_TERM}&limit=10" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.shortId)] \(.title) | \(.count) events"'
EOF
bash /tmp/query_sentry.sh
```

### 7. Issues in Last 24 Hours

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?query=is:unresolved+lastSeen:-24h&sort=freq&limit=20" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.shortId)] \(.title) | Events: \(.count) | Users: \(.userCount) | \(.project.slug)"'
EOF
bash /tmp/query_sentry.sh
```

### 8. High-Impact Issues (Most Users Affected)

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?query=is:unresolved&sort=user&limit=10" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.shortId)] \(.title) | Users: \(.userCount) | Events: \(.count)"'
EOF
bash /tmp/query_sentry.sh
```

### 9. Error Statistics (Last 24h)

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

PROJECT="nextjs-app"  # Replace with project slug

curl -s "https://sentry.io/api/0/projects/${SENTRY_ORG}/${PROJECT}/stats/?stat=received&resolution=1h" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq 'map({timestamp: .[0], events: .[1]}) | .[-24:]'
EOF
bash /tmp/query_sentry.sh
```

### 10. List Events for Issue

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s "https://sentry.io/api/0/issues/${ISSUE_ID}/events/?limit=10" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.eventID | .[0:8])] \(.dateCreated) | \(.tags | map(select(.key == "browser" or .key == "os")) | map("\(.key):\(.value)") | join(", "))"'
EOF
bash /tmp/query_sentry.sh
```

### 11. Issues by Environment

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

ENV="production"  # Or: staging, development

curl -s "https://sentry.io/api/0/organizations/${SENTRY_ORG}/issues/?query=is:unresolved+environment:${ENV}&limit=15" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.shortId)] \(.title) | \(.count) events | \(.project.slug)"'
EOF
bash /tmp/query_sentry.sh
```

---

## Issue Management (Write Operations)

**⚠️ These operations modify Sentry data. Safe to use after fixing the underlying code.**

### 12. Resolve an Issue

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}' | jq '{id: .shortId, status: .status}'
EOF
bash /tmp/query_sentry.sh
```

### 13. Resolve in Next Release

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved", "statusDetails": {"inNextRelease": true}}' | jq '{id: .shortId, status: .status}'
EOF
bash /tmp/query_sentry.sh
```

### 14. Ignore/Mute an Issue

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

# Ignore forever
curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "ignored"}' | jq '{id: .shortId, status: .status}'
EOF
bash /tmp/query_sentry.sh
```

### 15. Ignore Until Condition

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

# Ignore until 100 more events
curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "ignored", "statusDetails": {"ignoreCount": 100}}' | jq '{id: .shortId, status: .status}'

# Or ignore for 24 hours
# -d '{"status": "ignored", "statusDetails": {"ignoreDuration": 1440}}'

# Or ignore until 10 more users affected
# -d '{"status": "ignored", "statusDetails": {"ignoreUserCount": 10}}'
EOF
bash /tmp/query_sentry.sh
```

### 16. Reopen an Issue (Unresolve)

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "unresolved"}' | jq '{id: .shortId, status: .status}'
EOF
bash /tmp/query_sentry.sh
```

### 17. Assign Issue to User

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID
USER_EMAIL="developer@example.com"  # Replace with assignee email

curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"assignedTo\": \"${USER_EMAIL}\"}" | jq '{id: .shortId, assignedTo: .assignedTo}'
EOF
bash /tmp/query_sentry.sh
```

### 18. Unassign Issue

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s -X PUT "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"assignedTo": null}' | jq '{id: .shortId, assignedTo: .assignedTo}'
EOF
bash /tmp/query_sentry.sh
```

### 19. Bulk Resolve Multiple Issues

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')
SENTRY_ORG=$(grep "^SENTRY_ORG=" .env.local | cut -d '=' -f2 | tr -d '"')

PROJECT="nextjs-app"  # Replace with project slug

# Resolve all issues matching a query
curl -s -X PUT "https://sentry.io/api/0/projects/${SENTRY_ORG}/${PROJECT}/issues/?query=is:unresolved+TypeError" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}' | jq '.'
EOF
bash /tmp/query_sentry.sh
```

### 20. Delete an Issue (⚠️ PERMANENT)

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s -X DELETE "https://sentry.io/api/0/issues/${ISSUE_ID}/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq '.'
EOF
bash /tmp/query_sentry.sh
```

### 21. Add Comment/Note to Issue

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID
COMMENT="Fixed in commit abc123 - added null check in Dashboard.tsx"

curl -s -X POST "https://sentry.io/api/0/issues/${ISSUE_ID}/comments/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"${COMMENT}\"}" | jq '{id: .id, text: .text, dateCreated: .dateCreated}'
EOF
bash /tmp/query_sentry.sh
```

### 22. List Comments on Issue

```bash
cat > /tmp/query_sentry.sh << 'EOF'
#!/bin/bash
SENTRY_AUTH_TOKEN=$(grep "^SENTRY_AUTH_TOKEN=" .env.local | cut -d '=' -f2 | tr -d '"')

ISSUE_ID="PROJ-123"  # Replace with issue short ID

curl -s "https://sentry.io/api/0/issues/${ISSUE_ID}/comments/" \
  -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" | jq -r '.[] | "[\(.dateCreated)] \(.user.name): \(.text)"'
EOF
bash /tmp/query_sentry.sh
```

---

## AI Workflow: Investigate → Fix → Close

**Recommended workflow for using this skill with AI:**

1. **List recent issues:**
   ```
   Use query #2 or #7 to see unresolved issues
   ```

2. **Get issue details + stack trace:**
   ```
   Use query #4 and #5 to understand the error
   ```

3. **Fix the code:**
   ```
   AI analyzes the stack trace and fixes the bug in the codebase
   ```

4. **Add comment explaining the fix:**
   ```
   Use query #21 to document what was changed
   ```

5. **Resolve the issue:**
   ```
   Use query #12 to mark as resolved
   ```

---

## Query Syntax Reference

### Search Operators
- `is:unresolved` - Unresolved issues only
- `is:resolved` - Resolved issues
- `is:ignored` - Ignored/muted issues
- `is:assigned` - Assigned to someone
- `is:unassigned` - Not assigned

### Time Filters
- `lastSeen:-24h` - Seen in last 24 hours
- `lastSeen:-7d` - Seen in last 7 days
- `firstSeen:-1h` - First seen in last hour
- `age:-30d` - Created in last 30 days

### Sort Options
- `sort=date` - Most recent first (default)
- `sort=freq` - Most frequent first
- `sort=user` - Most users affected first
- `sort=priority` - By priority score

### Environment Filters
- `environment:production`
- `environment:staging`
- `environment:development`

### Tag Filters
- `browser:Chrome`
- `os:Windows`
- `release:1.0.0`
- `level:error` (error, warning, info)

### Combined Examples
```
is:unresolved lastSeen:-24h environment:production
is:unresolved sort:user level:error
TypeError is:unresolved project:nextjs-app
```

---

## Output Formatting

### For Issue Lists
```
## Recent Unresolved Issues

[NEXTJS-ABC] TypeError: Cannot read property 'x' of undefined | 142 events | nextjs-app | 2025-11-25T10:30:00
[RUST-XYZ] panic at 'index out of bounds' | 23 events | rust-executor | 2025-11-25T09:15:00
```

### For Issue Details
```
## Issue: NEXTJS-ABC

Title: TypeError: Cannot read property 'x' of undefined
Culprit: src/components/Dashboard.tsx in render
Status: unresolved
Level: error

Events: 142
Users Affected: 89
First Seen: 2025-11-20T08:00:00
Last Seen: 2025-11-25T10:30:00

Stack Trace (last 3 frames):
1. src/components/Dashboard.tsx:45 in render
2. src/hooks/useData.ts:23 in fetchData
3. node_modules/react/index.js:102 in Component
```

---

## Error Handling

### Common Issues

**"401 Unauthorized"**
- Check SENTRY_AUTH_TOKEN is correct
- Token may have expired - create a new one
- Token missing required scopes (need: project:read, org:read, event:read)

**"404 Not Found"**
- Check SENTRY_ORG slug is correct (lowercase, hyphenated)
- Project slug may be wrong
- Issue ID may not exist

**"Empty result `[]`"**
- No issues matching query
- Try broader search (remove filters)
- Check project has data

**"Rate limited"**
- Sentry API has rate limits
- Wait a few seconds and retry
- Use pagination for large queries

---

## Important Notes

1. **Auth token scopes:** Need `project:read`, `org:read`, `event:read` at minimum
2. **Org slug:** Find at sentry.io/settings/[org-slug]/
3. **Project slugs:** Use query #1 to list all projects
4. **Issue IDs:** Use short format like `PROJ-ABC` not numeric IDs
5. **Rate limits:** ~100 requests/minute for most endpoints
6. **Pagination:** Use `cursor` param for large result sets
7. **Read-only by default:** Only modify with explicit user confirmation
