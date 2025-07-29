import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isAdminRoute = createRouteMatcher([
  '/admin(.*)'
]);

const isDeploymentRoute = createRouteMatcher([
  '/deployments(.*)'
]);

const isPublicApiRoute = createRouteMatcher([
  '/api/ingest(.*)',
  '/api/stream(.*)',
  '/api/capture(.*)',
  '/api/initiate-workflow-analysis(.*)',
  '/api/refine-workflow-list(.*)',
  '/api/define-workflow-boundaries(.*)',
  '/api/synthesize-workflow(.*)',
  '/api/timeline-event-mappings/bulk(.*)'
]);

const isProtectedApiRoute = createRouteMatcher([
  '/api/workflows/export(.*)',
  '/api/analyze-raw-timeline-events(.*)',
  '/api/users/(.*)',
  '/api/sessions/(.*)',
  '/api/timeline-event-mappings/(?!bulk)(.*)',
  '/api/save-dataset-entry(.*)',
  '/api/fetch-analyses-by-timestamps(.*)',
  '/api/fetch-combined-analyses-v2(.*)',
  '/api/generate-events(.*)',
  '/api/mcp/(.*)',
  '/api/remote-workflows/(.*)',
  '/api/edit-workflow(.*)',
  '/api/workflows/(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  // Skip authentication for public API routes
  if (isPublicApiRoute(req)) {
    return;
  }
  
  // Handle protected API routes - require authentication but allow any authenticated user
  if (isProtectedApiRoute(req)) {
    const { userId } = await auth();
    
    if (!userId) {
      console.log('[Middleware] Protected API route accessed without authentication:', req.url);
      await auth.protect();
      return;
    }
    
    console.log('[Middleware] Protected API route accessed by authenticated user:', userId);
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
    console.log('[Middleware Debug] Session Claims:', JSON.stringify(sessionClaims, null, 2));
    
    // Add more detailed debugging
    console.log('[Middleware Debug] Full auth object keys:', Object.keys(auth));
    console.log('[Middleware Debug] Has function result for org:admin:', has({ role: 'org:admin' }));
    console.log('[Middleware Debug] Has function result for org:member:', has({ role: 'org:member' }));
    
    const hasOrgAdminRole = has({ role: 'org:admin' });
    const hasOrgMemberRole = has({ role: 'org:member' });
    
    const organizationMemberships = sessionClaims?.organizationMemberships || {};
    console.log('[Middleware Debug] Organization memberships:', organizationMemberships);
    console.log('[Middleware Debug] Organization memberships type:', typeof organizationMemberships);
    console.log('[Middleware Debug] Organization memberships keys:', Object.keys(organizationMemberships));
    
    let hasAnyAdminRole = hasOrgAdminRole;
    let hasAnyMemberRole = hasOrgMemberRole;
    
    // Handle organization memberships as object { orgId: role }
    if (typeof organizationMemberships === 'object' && organizationMemberships !== null) {
      for (const [orgId, role] of Object.entries(organizationMemberships)) {
        console.log('[Middleware Debug] Checking membership:', { orgId, role });
        if (role === 'org:admin') {
          hasAnyAdminRole = true;
        }
        if (role === 'org:member' || role === 'org:admin') {
          hasAnyMemberRole = true;
        }
      }
    }
    
    console.log('[Middleware Debug] Has org admin role:', hasOrgAdminRole);
    console.log('[Middleware Debug] Has org member role:', hasOrgMemberRole);
    console.log('[Middleware Debug] Has any admin role:', hasAnyAdminRole);
    console.log('[Middleware Debug] Has any member role:', hasAnyMemberRole);
    
    if (Object.keys(organizationMemberships).length > 0 && !orgId) {
      console.log('[Middleware Debug] User has orgs but no active org - redirecting to org selection');
      return Response.redirect(new URL('/select-organization', req.url));
    }
    
    if (!hasAnyAdminRole && !hasAnyMemberRole) {
      console.log('[Middleware Debug] Access denied - redirecting to unauthorized');
      return Response.redirect(new URL('/unauthorized', req.url));
    }
    
    console.log('[Middleware Debug] Access granted');
  }
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}; 