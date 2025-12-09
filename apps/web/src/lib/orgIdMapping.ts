/**
 * Environment-specific organization ID mapping utility
 * 
 * This handles the mismatch between Clerk dev environment org IDs
 * and production database org IDs, allowing local development
 * with production database data.
 */

// Environment-specific organization ID mappings
// Dev Clerk ID -> Production Database ID
const getOrgIdMapping = () => {
  return {
    [process.env.MEDIAR_DEV_ORG_ID || 'org_REDACTED']: 
      process.env.MEDIAR_PROD_ORG_ID || 'org_REDACTED',
    [process.env.STOKE_DEV_ORG_ID || 'org_REDACTED']: 
      process.env.STOKE_PROD_ORG_ID || 'org_REDACTED',
  };
};

// Reverse mapping for display purposes
// Production Database ID -> Dev Clerk ID
const getReverseOrgIdMapping = () => {
  return {
    [process.env.MEDIAR_PROD_ORG_ID || 'org_REDACTED']: 
      process.env.MEDIAR_DEV_ORG_ID || 'org_REDACTED',
    [process.env.STOKE_PROD_ORG_ID || 'org_REDACTED']: 
      process.env.STOKE_DEV_ORG_ID || 'org_REDACTED',
  };
};

/**
 * Converts Clerk dev org ID to database production org ID
 * Only applies mapping in development environment
 */
export function mapClerkIdToDbId(clerkOrgId: string): string {
  // Only map in development environment
  if (process.env.NODE_ENV === 'development') {
    const mapping = getOrgIdMapping();
    const mappedId = mapping[clerkOrgId];
    
    if (mappedId) {
      console.log(`[orgIdMapping] Mapping Clerk ID ${clerkOrgId} -> DB ID ${mappedId}`);
      return mappedId;
    }
  }
  
  return clerkOrgId;
}

/**
 * Converts database production org ID back to Clerk dev org ID
 * Only applies mapping in development environment
 */
export function mapDbIdToClerkId(dbOrgId: string): string {
  // Only map in development environment
  if (process.env.NODE_ENV === 'development') {
    const reverseMapping = getReverseOrgIdMapping();
    const mappedId = reverseMapping[dbOrgId];
    
    if (mappedId) {
      console.log(`[orgIdMapping] Reverse mapping DB ID ${dbOrgId} -> Clerk ID ${mappedId}`);
      return mappedId;
    }
  }
  
  return dbOrgId;
}

/**
 * Gets all possible org IDs (both dev and prod) for a given Clerk org ID
 * Useful for queries where you want to check both possibilities
 */
export function getAllPossibleOrgIds(clerkOrgId: string): string[] {
  if (process.env.NODE_ENV === 'development') {
    const dbId = mapClerkIdToDbId(clerkOrgId);
    return dbId !== clerkOrgId ? [clerkOrgId, dbId] : [clerkOrgId];
  }
  
  return [clerkOrgId];
}

/**
 * Debug utility to show current mapping configuration
 */
export function debugOrgIdMapping() {
  if (process.env.NODE_ENV === 'development') {
    console.log('[orgIdMapping] Current mapping configuration:');
    console.log('Dev -> Prod mappings:', getOrgIdMapping());
    console.log('Prod -> Dev mappings:', getReverseOrgIdMapping());
  }
}
