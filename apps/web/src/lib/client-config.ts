/**
 * Server-only, environment-driven configuration for organization-, user-, and
 * customer-specific identifiers.
 *
 * No customer-identifying values are committed to this repository. Real values
 * live only in the deployment environment (Vercel). When an env var is unset
 * (e.g. a fork, or local dev without secrets), the corresponding special-casing
 * simply does not apply, which is the safe default.
 *
 * For values that must also be read in client components, see
 * `constants.ts` (which uses NEXT_PUBLIC_* vars).
 */

function parseList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Mediar's own organization IDs (current + legacy).
export const MEDIAR_ORG_IDS = parseList(
  process.env.MEDIAR_ORG_IDS || process.env.NEXT_PUBLIC_MEDIAR_ORG_IDS
);

// The legacy Mediar org ID that historically also held early customer
// workflows; several routes special-case it for member / notification handling.
export const LEGACY_ORG_ID = process.env.LEGACY_ORG_ID || '';

// The pilot billing customer's organization ID.
export const BILLING_ORG_ID = process.env.BILLING_ORG_ID || '';

// Clerk user IDs (Mediar staff / GitHub-sync bot identity).
export const MEDIAR_PROD_USER_ID = process.env.MEDIAR_PROD_USER_ID || '';
export const MEDIAR_DEV_USER_ID = process.env.MEDIAR_DEV_USER_ID || '';
export const GITHUB_SYNC_USER_ID = process.env.GITHUB_SYNC_USER_ID || '';

/** True when the given org ID belongs to Mediar's own organization(s). */
export function isMediarOrg(orgId: string | null | undefined): boolean {
  return !!orgId && MEDIAR_ORG_IDS.includes(orgId);
}

/** True when the given org ID is the legacy Mediar org. */
export function isLegacyOrg(orgId: string | null | undefined): boolean {
  return !!orgId && !!LEGACY_ORG_ID && orgId === LEGACY_ORG_ID;
}
