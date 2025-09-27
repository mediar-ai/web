import { auth, currentUser } from '@clerk/nextjs/server';
import { MEDIAR_ORG_IDS } from './constants';

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
 * If user is a Mediar admin and has specified an override org, use that
 * Otherwise use the current org from Clerk
 */
export async function getEffectiveOrgId(overrideOrgId?: string | null): Promise<{
  orgId: string | null;
  isMediarOrg: boolean;
  isMediarAdmin: boolean;
  actualOrgId: string | null;
}> {
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