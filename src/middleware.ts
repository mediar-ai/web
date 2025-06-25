import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isAdminRoute = createRouteMatcher([
  '/admin(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  // Only protect admin routes, not all routes
  if (isAdminRoute(req)) {
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
    
    const hasOrgAdminRole = has({ role: 'org:admin' });
    const hasOrgMemberRole = has({ role: 'org:member' });
    
    const organizationMemberships = sessionClaims?.organizationMemberships || [];
    console.log('[Middleware Debug] Organization memberships:', organizationMemberships);
    
    let hasAnyAdminRole = hasOrgAdminRole;
    let hasAnyMemberRole = hasOrgMemberRole;
    
    if (Array.isArray(organizationMemberships)) {
      for (const membership of organizationMemberships) {
        console.log('[Middleware Debug] Checking membership:', membership);
        if (membership.role === 'admin') {
          hasAnyAdminRole = true;
        }
        if (membership.role === 'member' || membership.role === 'admin') {
          hasAnyMemberRole = true;
        }
      }
    }
    
    console.log('[Middleware Debug] Has org admin role:', hasOrgAdminRole);
    console.log('[Middleware Debug] Has org member role:', hasOrgMemberRole);
    console.log('[Middleware Debug] Has any admin role:', hasAnyAdminRole);
    console.log('[Middleware Debug] Has any member role:', hasAnyMemberRole);
    
    if (Array.isArray(organizationMemberships) && organizationMemberships.length > 0 && !orgId) {
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
  // Opt out of the Edge Runtime and use Node.js instead
  runtime: 'nodejs',
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}; 