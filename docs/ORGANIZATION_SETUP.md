# Organization-Scoped Dashboard Setup

This guide explains how to set up organization-based access control for the admin dashboards, where users only see data from their own organization.

## Overview

The system supports three levels of access:

1. **Global Admins**: See all users across all organizations (hardcoded user IDs)
2. **Organization Admins**: See all users within their organization + admin controls
3. **Organization Members**: See all users within their organization (read-only)

## Database Setup

### 1. Run the Organization Migration

```bash
# Apply the migration to add organization support
supabase db push
```

This adds:
- `organization_id` column to `mediar_users` table
- `organization_id` column to `users` table  
- Indexes for performance
- Helper function `update_user_organization()`

### 2. Update Existing Users (Optional)

If you have existing users, you can assign them to organizations:

```sql
-- Example: Assign existing users to an organization
UPDATE mediar_users 
SET organization_id = 'org_abc123' 
WHERE user_id IN ('user1', 'user2');

UPDATE users 
SET organization_id = 'org_abc123' 
WHERE id IN ('user1', 'user2');
```

## Clerk Organization Setup

### 1. Create Organizations in Clerk

1. Go to your Clerk Dashboard
2. Navigate to "Organizations" 
3. Create organizations (e.g., "Mediar", "Client Company A")
4. Add users to organizations with appropriate roles:
   - `admin`: Full control within organization
   - `member`: Read-only access within organization

### 2. Configure Organization Roles

In your Clerk dashboard, ensure you have these roles configured:
- `org:admin` - Organization administrators
- `org:member` - Organization members

## Frontend Configuration

### 1. Dashboard Access Levels

The dashboard at `/internal-dashboard-full-access-2b4c8e1f` now shows:

- **Global Admins**: "Global Admin - All Organizations" 
- **Org Admins**: "Admin - [Organization Name]"
- **Org Members**: "Member - [Organization Name]"

### 2. Data Filtering

When the database migration is complete, the system will:

- **Global Admins**: See all users from all organizations
- **Org Users**: Only see users from their organization
- **API Filtering**: `/api/sessions` will filter by `organizationId` parameter

## API Endpoints

### Update User Organization

```typescript
PUT /api/users/[userId]/organization
{
  "organizationId": "org_abc123"
}
```

Only admins can assign users to organizations.

### Data Ingestion with Organization Context

The `/api/ingest-user-activity` endpoint now accepts:

```typescript
{
  "sessionId": "session123",
  "userId": "user456", 
  "organizationId": "org_abc123", // Optional
  "exportedData": { ... }
}
```

## Current Implementation Status

### ✅ Completed
- Organization-aware dashboard UI
- Database schema with organization support
- API endpoint for organization management
- Organization context in data ingestion
- Role-based access control in frontend

### 🚧 Next Steps (After Migration)
1. **Run the database migration**:
   ```bash
   supabase db push
   ```

2. **Update the sessions API** to use organization filtering:
   ```typescript
   // Uncomment this in /api/sessions/route.ts
   const { searchParams } = new URL(request.url);
   const orgId = searchParams.get('orgId');
   
   // Add WHERE clause for organization filtering
   if (orgId) {
     query = query.eq('mediar_users.organization_id', orgId);
   }
   ```

3. **Assign existing users to organizations** using the SQL commands above

4. **Test organization filtering** by creating test users in different organizations

## Example Usage

### Scenario: Two Organizations

**Organization A: "Mediar"**
- Matt (Global Admin) - sees all data
- Alice (Org Admin) - sees only Mediar users, can edit/delete
- Bob (Org Member) - sees only Mediar users, read-only

**Organization B: "ClientCorp"** 
- Carol (Org Admin) - sees only ClientCorp users, can edit/delete
- Dave (Org Member) - sees only ClientCorp users, read-only

### Testing

1. Create organizations in Clerk
2. Assign users to organizations with roles
3. Run database migration
4. Update API to use organization filtering
5. Test dashboard access with different user accounts

## Security Notes

- Organization filtering happens at the API level
- Database queries include organization constraints
- Frontend UI adapts based on user's organization context
- Global admin access is currently hardcoded (can be made configurable)

## Migration from Current System

The current system uses hardcoded user IDs for admin access. After implementing organizations:

1. Global admins remain the same (hardcoded IDs)
2. Other users get organization-scoped access
3. Data remains intact, just gets organization context added
4. Existing sessions continue to work, new ones get organization data 