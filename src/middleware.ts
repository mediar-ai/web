import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const isAdminRoute = createRouteMatcher([
  '/admin(.*)'
  // Removed homepage from admin routes - let users access it freely
]);

const isDeploymentRoute = createRouteMatcher(['/deployments(.*)']);

const isPublicApiRoute = createRouteMatcher([
  '/api/ingest(.*)',
  '/api/stream(.*)',
  '/api/capture(.*)',
  '/api/initiate-workflow-analysis(.*)',
  '/api/refine-workflow-list(.*)',
  '/api/define-workflow-boundaries(.*)',
  '/api/synthesize-workflow(.*)',
  '/api/timeline-event-mappings/bulk(.*)',
  '/api/workflows/orchestrate(.*)',
  '/api/analyze-raw-timeline-events(.*)',
  '/api/sync-processed-counts(.*)',
  '/api/process-workflow-step(.*)',
  // Modal executor needs this endpoint to report status (has X-Service-Auth validation)
  '/api/remote-workflows/executions/monitor(.*)',
  // Workflow execution endpoints have their own auth (service role key + bypass token for cron, Clerk for users)
  '/api/remote-workflows/:workflowId/execute',
  '/api/remote-workflows/:workflowId/execute-sync',
  '/api/cron/scheduler(.*)',
  '/api/cron/health-check-supabase(.*)',
  '/api/cron/process-pending-notifications(.*)',
  '/api/ai/execution-qa/context(.*)', // Allow context loading without auth (data is org-scoped)
  '/api/agents(.*)', // Allow agent streaming for desktop app (has own auth via Bearer token)
  // Workflow download route handles its own auth (service token or Clerk session)
  '/api/workflows-uuid/download(.*)',
]);

const isProtectedApiRoute = createRouteMatcher([
  '/api/workflows/export(.*)',
  '/api/users/(.*)',
  '/api/sessions/(.*)',
  '/api/timeline-event-mappings(.*)',
  '/api/save-dataset-entry(.*)',
  '/api/fetch-analyses-by-timestamps(.*)',
  '/api/fetch-combined-analyses-v2(.*)',
  '/api/generate-events(.*)',
  '/api/mcp/(.*)',
  '/api/edit-workflow(.*)',
  '/api/workflows/(.*)',
  '/api/ai/(.*)',  // Add all /api/ai routes as protected
  '/api/remote-workflows/(.*)',  // Protect all remote-workflows routes (except monitor which is public)
]);

export default clerkMiddleware(async (auth, req) => {
  // Skip authentication for public API routes
  if (isPublicApiRoute(req)) {
    return;
  }

  // Handle protected API routes - require authentication but allow any authenticated user
  if (isProtectedApiRoute(req)) {
    // Skip auth for OPTIONS requests (CORS preflight) - let route handler respond
    if (req.method === 'OPTIONS') {
      return;
    }

    // First, check for desktop token in Authorization header
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      try {
        const validation = await validateDesktopToken(token);
        if (validation.valid) {
          console.log(
            `[Middleware] Protected API route accessed with desktop token for user: ${validation.email}`
          );
          return; // Allow access for valid desktop tokens
        }
      } catch (error) {
        // Desktop token validation failed, fall through to Clerk auth
        console.log('[Middleware] Desktop token validation failed, trying Clerk auth');
      }
    }

    // Fall back to Clerk authentication
    const { userId } = await auth();

    if (!userId) {
      console.log(
        '[Middleware] Protected API route accessed without authentication:',
        req.url
      );
      await auth.protect();
      return;
    }

    console.log(
      '[Middleware] Protected API route accessed by authenticated user:',
      userId
    );
    return; // Allow access for authenticated users
  }

  // Protect admin and deployment routes
  if (isAdminRoute(req) || isDeploymentRoute(req)) {
    const { userId } = await auth();

    // Protect admin routes by requiring authentication
    if (!userId) {
      await auth.protect();
      return;
    }

    const { has, orgId, orgRole, orgSlug, sessionClaims } = await auth();

    // Debug logging to see what Clerk is providing
    console.log('[Middleware Debug] User ID:', userId);
    console.log('[Middleware Debug] Org ID:', orgId);
    console.log('[Middleware Debug] Org Role:', orgRole);
    console.log('[Middleware Debug] Org Slug:', orgSlug);
    console.log(
      '[Middleware Debug] Session Claims:',
      JSON.stringify(sessionClaims, null, 2)
    );

    // Add more detailed debugging
    console.log('[Middleware Debug] Full auth object keys:', Object.keys(auth));
    console.log(
      '[Middleware Debug] Has function result for org:admin:',
      has({ role: 'org:admin' })
    );
    console.log(
      '[Middleware Debug] Has function result for org:member:',
      has({ role: 'org:member' })
    );
    console.log(
      '[Middleware Debug] Has function result for org:owner:',
      has({ role: 'org:owner' })
    );

    const hasOrgAdminRole = has({ role: 'org:admin' });
    const hasOrgMemberRole = has({ role: 'org:member' });
    const hasOrgOwnerRole = has({ role: 'org:owner' });

    const organizationMemberships =
      sessionClaims?.organizationMemberships || {};
    console.log(
      '[Middleware Debug] Organization memberships:',
      organizationMemberships
    );
    console.log(
      '[Middleware Debug] Organization memberships type:',
      typeof organizationMemberships
    );
    console.log(
      '[Middleware Debug] Organization memberships keys:',
      Object.keys(organizationMemberships)
    );

    let hasAnyAdminRole = hasOrgAdminRole || hasOrgOwnerRole; // Owners have admin privileges
    let hasAnyMemberRole = hasOrgMemberRole;

    // Handle organization memberships as object { orgId: role }
    if (
      typeof organizationMemberships === 'object' &&
      organizationMemberships !== null
    ) {
      for (const [orgId, role] of Object.entries(organizationMemberships)) {
        console.log('[Middleware Debug] Checking membership:', { orgId, role });
        if (role === 'org:admin' || role === 'org:owner') {
          hasAnyAdminRole = true;
        }
        if (
          role === 'org:member' ||
          role === 'org:admin' ||
          role === 'org:owner'
        ) {
          hasAnyMemberRole = true;
        }
      }
    }

    console.log('[Middleware Debug] Has org admin role:', hasOrgAdminRole);
    console.log('[Middleware Debug] Has org member role:', hasOrgMemberRole);
    console.log('[Middleware Debug] Has org owner role:', hasOrgOwnerRole);
    console.log('[Middleware Debug] Has any admin role:', hasAnyAdminRole);
    console.log('[Middleware Debug] Has any member role:', hasAnyMemberRole);
    
    // Allow users to access homepage even without active org - let them choose where to go
    // if (Object.keys(organizationMemberships).length > 0 && !orgId) {
    //   console.log('[Middleware Debug] User has orgs but no active org - redirecting to org selection');
    //   return Response.redirect(new URL('/select-organization', req.url));
    // }
    
    if (!hasAnyAdminRole && !hasAnyMemberRole) {
      console.log(
        '[Middleware Debug] Access denied - redirecting to unauthorized'
      );
      return Response.redirect(new URL('/unauthorized', req.url));
    }

    console.log('[Middleware Debug] Access granted');
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
