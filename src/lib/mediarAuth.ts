import { auth, currentUser } from '@clerk/nextjs/server';
import { MEDIAR_ORG_IDS } from './constants';
import { validateDesktopToken } from './auth/validateDesktopToken';
import { headers } from 'next/headers';

/**
 * Check if the current user is a Mediar admin (has @mediar.ai email)
 */
export async function isMediarAdmin(): Promise<boolean> {
  try {
    const user = await currentUser();
    if (!user) return false;

    // Check if any of the user's emails end with @mediar.ai
    const hasMediarEmail = user.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    return hasMediarEmail;
  } catch (error) {
    console.error('Error checking Mediar admin status:', error);
    return false;
  }
}

/**
 * Get the effective organization ID for the current request
 * Checks for desktop token auth first, then falls back to Clerk auth
 * If user is a Mediar admin and has specified an override org, use that
 * Otherwise use the current org from Clerk or desktop token
 */
export async function getEffectiveOrgId(overrideOrgId?: string | null): Promise<{
  orgId: string | null;
  isMediarOrg: boolean;
  isMediarAdmin: boolean;
  actualOrgId: string | null;
}> {
  // First, check for desktop token authentication
  const headersList = await headers();
  const authHeader = headersList.get('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    try {
      const validation = await validateDesktopToken(token);

      if (validation.valid && validation.orgId) {
        console.log(`[mediarAuth] Using org from desktop token: ${validation.orgId} for user: ${validation.email}`);

        // Check if the user is a Mediar admin based on email
        const isDesktopMediarAdmin = validation.email?.toLowerCase().endsWith('@mediar.ai') || false;

        // If desktop user is a Mediar admin and provided an override, use it
        const effectiveOrgId = (isDesktopMediarAdmin && overrideOrgId) ? overrideOrgId : validation.orgId;

        // Check if the effective org is a Mediar org
        const isMediarOrg = effectiveOrgId ? MEDIAR_ORG_IDS.includes(effectiveOrgId) : false;

        return {
          orgId: effectiveOrgId || null,
          isMediarOrg: isMediarOrg,
          isMediarAdmin: isDesktopMediarAdmin,
          actualOrgId: validation.orgId || null, // The actual org from desktop token
        };
      }
    } catch (error) {
      console.log('[mediarAuth] Desktop token validation failed, falling back to Clerk auth:', error);
      // Fall through to Clerk auth
    }
  }

  // Fall back to Clerk authentication
  const { orgId: clerkOrgId } = await auth();
  const mediarAdmin = await isMediarAdmin();

  // If user is a Mediar admin and provided an override, use it
  const effectiveOrgId = (mediarAdmin && overrideOrgId) ? overrideOrgId : clerkOrgId;

  // Check if the effective org is a Mediar org
  const isMediarOrg = effectiveOrgId ? MEDIAR_ORG_IDS.includes(effectiveOrgId) : false;

  return {
    orgId: effectiveOrgId || null,
    isMediarOrg: isMediarOrg, // Only true if the effective org ID is actually a Mediar org
    isMediarAdmin: mediarAdmin,
    actualOrgId: clerkOrgId || null, // The actual Clerk org context
  };
}