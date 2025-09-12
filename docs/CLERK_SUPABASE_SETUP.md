# Clerk + Supabase RLS Integration Setup

This guide explains how to configure Clerk to work with the new Supabase RLS policies.

## Prerequisites

1. Clerk account with your application configured
2. Supabase project
3. The new RLS migration applied (`20260130000001_rls_security_with_clerk_integration.sql`)

## Step 1: Create Supabase JWT Template in Clerk

1. Go to your Clerk Dashboard
2. Navigate to **JWT Templates** 
3. Click **New template**
4. Select **Supabase** as the template type (or create a blank template)
5. Configure the template with these settings:

```json
{
  "aud": "authenticated",
  "role": "authenticated",
  "iss": "https://your-clerk-frontend-api.clerk.accounts.dev",
  "sub": "{{user.id}}",
  "user_id": "{{user.id}}",
  "email": "{{user.primary_email_address}}",
  "user_metadata": {
    "name": "{{user.full_name}}"
  }
}
```

6. Set the **Signing algorithm** to `HS256`
7. Use your Supabase JWT secret as the **Signing key**:
   - Find this in Supabase Dashboard → Settings → API → JWT Secret
   - Or decode it from your `SUPABASE_SERVICE_KEY` (the secret is the same)

8. Name the template `supabase`
9. Save the template

## Step 2: Update Environment Variables

Make sure you have these environment variables set:

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ... # Only for server-side admin operations
```

## Step 3: Update Your API Routes

Replace direct Supabase client usage with the new Clerk-aware clients:

### Before (insecure):
```typescript
// ❌ Old way - using service key everywhere
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // Bypasses all RLS!
);

const { data } = await supabase.from('workflows').select('*');
```

### After (secure):
```typescript
// ✅ New way - using Clerk authentication
import { createClerkSupabaseClient } from '@/lib/supabase-clerk';

export async function GET() {
  try {
    // This client respects RLS policies
    const supabase = await createClerkSupabaseClient();
    
    // Will only return workflows the user has access to
    const { data, error } = await supabase
      .from('low_level_workflows')
      .select('*');
    
    if (error) throw error;
    
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

## Step 4: Admin Operations

For admin operations that need to bypass RLS:

```typescript
import { 
  createServiceSupabaseClient, 
  getClerkUserId 
} from '@/lib/supabase-clerk';

export async function DELETE(req: Request) {
  // 1. First check if user is admin
  const userId = await getClerkUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const serviceClient = createServiceSupabaseClient();
  
  // 2. Verify admin role
  const { data: user } = await serviceClient
    .from('mediar_users')
    .select('role')
    .eq('user_id', userId)
    .single();
  
  if (user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  // 3. Now safe to perform admin operation
  const { error } = await serviceClient
    .from('low_level_workflows')
    .delete()
    .eq('id', req.params.id);
  
  if (error) throw error;
  
  return NextResponse.json({ success: true });
}
```

## Step 5: Client-Side Usage

For client-side components:

```typescript
// components/WorkflowList.tsx
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useAuth } from '@clerk/nextjs';

export function WorkflowList() {
  const { getToken } = useAuth();
  const [workflows, setWorkflows] = useState([]);
  
  useEffect(() => {
    async function fetchWorkflows() {
      // Get Clerk token
      const token = await getToken({ template: 'supabase' });
      
      // Create Supabase client with Clerk token
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        }
      );
      
      // Fetch workflows - RLS will filter based on user
      const { data } = await supabase
        .from('low_level_workflows')
        .select('*');
      
      setWorkflows(data || []);
    }
    
    fetchWorkflows();
  }, [getToken]);
  
  return (
    <div>
      {workflows.map(w => (
        <div key={w.id}>{w.name}</div>
      ))}
    </div>
  );
}
```

## Step 6: Test the Integration

1. **Test user isolation**: 
   - Log in as User A, create some workflows
   - Log in as User B, verify you can't see User A's workflows

2. **Test organization access**:
   - Create users in the same organization
   - Verify they can see shared organizational data

3. **Test admin access**:
   - Set a user's role to 'admin' in `mediar_users` table
   - Verify they have appropriate elevated access

4. **Test service role**:
   - Verify API routes using service client still work
   - Check that audit logs are being created

## Migration Rollback

If you need to rollback the RLS policies:

```sql
-- Disable RLS on all tables
ALTER TABLE public.low_level_datasets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_timeline_event_annotations DISABLE ROW LEVEL SECURITY;
-- ... (repeat for all tables)

-- Drop all Clerk-specific policies
DROP POLICY IF EXISTS "users_profile_select_clerk" ON public.mediar_users;
-- ... (drop all policies ending with _clerk)

-- Drop Clerk helper functions
DROP FUNCTION IF EXISTS public.get_clerk_user_id();
DROP FUNCTION IF EXISTS public.is_service_role();
DROP FUNCTION IF EXISTS public.get_user_organization_id();
DROP FUNCTION IF EXISTS public.is_user_organization_admin();
```

## Security Benefits

With this setup:
1. ✅ Users can only access their own data
2. ✅ Organization members can share data securely  
3. ✅ Service keys are only used when absolutely necessary
4. ✅ All data access is audited
5. ✅ RLS policies are enforced at the database level
6. ✅ No risk of accidentally exposing other users' data

## Troubleshooting

### "Permission denied" errors
- Check that the Clerk JWT template is configured correctly
- Verify the user exists in `mediar_users` table
- Check RLS policies with: `SELECT * FROM pg_policies WHERE tablename = 'your_table';`

### Service role operations failing
- Ensure `SUPABASE_SERVICE_KEY` env var is set
- Check that you're using `createServiceSupabaseClient()` for admin operations

### Clerk token not working
- Verify JWT template name matches ('supabase')
- Check that signing key matches Supabase JWT secret
- Test token generation with `getToken({ template: 'supabase' })`