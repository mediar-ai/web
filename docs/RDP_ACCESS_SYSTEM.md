# Authenticated RDP Access System

## Overview

The mediar-web-app now provides secure, authenticated access to agent machine screens through Apache Guacamole with organization-based access control.

## Architecture

```
User (Browser - HTTPS)
  ↓
mediar-web-app (/api/rdp/access)
  ↓ [Validates Clerk auth + org access]
  ↓
Guacamole REST API (http://guacamole:8080)
  ↓ [Authenticates, returns token]
  ↓
Guacamole Client (iframe with token-based URL)
  ↓ [Full RDP interaction]
  ↓
Windows VM (Session 1 - where agent runs)
```

## Security Features

### 1. Authentication
- **Clerk JWT validation** - All requests require valid Clerk session
- **Organization membership** - User must belong to authorized org
- **Token-based Guacamole access** - No credentials in frontend

### 2. Authorization
Org access is validated through multiple layers:

#### Workflow-Level Access
- User owns the workflow
- User is org admin in same org as workflow
- User's org has explicit access via `workflow_organization_access` table
- User is Mediar admin (can access any execution)

#### Machine-Level Access
- Machine is global (`is_global = true`)
- User's org has assignment in `machine_organization_assignments`

### 3. Audit Trail
- All RDP access requests are logged with:
  - User ID
  - Organization ID
  - Execution ID / Machine ID
  - Timestamp
  - Success/failure status

## API Endpoint

### `GET /api/rdp/access`

Generates an authenticated Guacamole connection URL for viewing an agent's screen.

**Query Parameters:**
- `execution_id` (optional) - Workflow execution ID to access
- `machine_id` (optional) - Direct machine ID to access

**Response:**
```json
{
  "success": true,
  "connection_url": "http://4.157.122.69:8080/guacamole/#/client/1?token=ABC123...",
  "connection_name": "MCP-MACHINE-01",
  "machine_id": 123,
  "machine_name": "MACHINE-01",
  "expires_in_minutes": 60,
  "note": "This URL contains a time-limited authentication token. Do not share it."
}
```

**Error Responses:**
- `401 Unauthorized` - No valid Clerk session
- `403 Forbidden` - User's org doesn't have access to this machine/execution
- `404 Not Found` - Execution or machine not found
- `500 Internal Server Error` - Guacamole authentication failed

## Frontend Component

### ExecutionDetailsDialog - Agent Screen Tab

The "Agent Screen" tab in the execution details dialog now:

1. **Fetches authenticated URL** on load
2. **Shows loading state** while authenticating
3. **Handles errors** gracefully with user-friendly messages
4. **Embeds iframe** with token-based Guacamole URL
5. **No manual login required** - seamless experience

**Features:**
- Full mouse and keyboard control
- Clipboard integration (copy/paste between browser and VM)
- Real-time RDP streaming
- Automatic reconnection on token expiry

## Environment Variables

Add to `.env.local`:

```bash
# Guacamole Configuration
GUACAMOLE_URL=http://4.157.122.69:8080/guacamole
GUACAMOLE_USERNAME=admin
GUACAMOLE_PASSWORD=mediar123
```

## Guacamole Client Library

**Location:** `src/lib/guacamole-client.ts`

Provides helper functions for:
- `authenticateGuacamole()` - Get auth token from Guacamole
- `getGuacamoleConnections()` - List available RDP connections
- `findConnectionByName()` - Match machine to connection
- `generateConnectionUrl()` - Build iframe-ready URL with token
- `getDirectConnectionUrl()` - All-in-one helper

## Database Schema

### Required Tables

#### `workflow_organization_access`
```sql
CREATE TABLE workflow_organization_access (
  id BIGSERIAL PRIMARY KEY,
  workflow_id BIGINT REFERENCES deployed_workflows(id),
  organization_id TEXT NOT NULL,
  access_level TEXT DEFAULT 'read',
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `machine_organization_assignments`
```sql
CREATE TABLE machine_organization_assignments (
  id BIGSERIAL PRIMARY KEY,
  machine_id BIGINT REFERENCES remote_machines(id),
  organization_id TEXT NOT NULL,
  assigned_at TIMESTAMP DEFAULT NOW()
);
```

## Troubleshooting

### Mixed Content Error
**Problem:** Browser blocks HTTP iframe in HTTPS page

**Solution:** The current implementation still uses HTTP Guacamole URL. To fix:
1. Add reverse proxy (Caddy/Nginx) with HTTPS in front of Guacamole
2. Or: Proxy through mediar-web-app backend (future enhancement)

### Token Expiration
**Problem:** Guacamole tokens expire after ~60 minutes

**Solution:** Frontend automatically refetches token when user reopens the tab. For long sessions, implement token refresh mechanism.

### Connection Not Found
**Problem:** API returns "No Guacamole connection found for machine"

**Causes:**
1. Machine name mismatch between DB and Guacamole config
2. Guacamole container not running
3. user-mapping.xml not properly configured

**Debug:**
```bash
# Check Guacamole is running
az container show --name guacamole-gateway --resource-group mcp-s3-mount-test

# List available connections
curl -X POST http://4.157.122.69:8080/guacamole/api/tokens \
  -d "username=admin&password=mediar123" | jq .

# Get connection list
curl "http://4.157.122.69:8080/guacamole/api/session/data/default/connections?token=TOKEN" | jq .
```

## Future Improvements

- [ ] Add WebSocket proxy through mediar-web-app for HTTPS
- [ ] Implement token refresh for long sessions
- [ ] Add session recording/audit playback
- [ ] Multi-monitor support
- [ ] File transfer UI
- [ ] Connection quality indicators
- [ ] Bandwidth usage metrics
- [ ] Screen sharing (multiple users viewing same session)

## Related Files

- `/src/app/api/rdp/access/route.ts` - Main API endpoint
- `/src/lib/guacamole-client.ts` - Guacamole REST API client
- `/src/components/deployments/ExecutionDetailsDialog.tsx` - UI component
- `/agents/packer-terraform/guacamole-deployment/` - Guacamole infrastructure

## References

- [Apache Guacamole Documentation](https://guacamole.apache.org/doc/gug/)
- [Guacamole REST API (unofficial)](https://github.com/ridvanaltun/guacamole-rest-api-documentation)
- [RDP Shadow Mode Documentation](https://docs.microsoft.com/en-us/windows-server/remote/remote-desktop-services/clients/remote-desktop-allow-access)
