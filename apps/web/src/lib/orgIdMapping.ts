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
    [process.env.MEDIAR_DEV_ORG_ID || 'org_2yydAO45WOB4RaCE4F4BNUPtw9c']: 
      process.env.MEDIAR_PROD_ORG_ID || 'org_2yynzGa53bNM1GTPLp5mc2lYRyD',
    [process.env.STOKE_DEV_ORG_ID || 'org_2yycYh2ig5m8LwgONhJfZGYhkm9']: 
      process.env.STOKE_PROD_ORG_ID || 'org_2yyo35c5YVUqjJ86qen45VfwwxD',
  };
};

// Reverse mapping for display purposes
// Production Database ID -> Dev Clerk ID
const getReverseOrgIdMapping = () => {
  return {
    [process.env.MEDIAR_PROD_ORG_ID || 'org_2yynzGa53bNM1GTPLp5mc2lYRyD']: 
      process.env.MEDIAR_DEV_ORG_ID || 'org_2yydAO45WOB4RaCE4F4BNUPtw9c',
    [process.env.STOKE_PROD_ORG_ID || 'org_2yyo35c5YVUqjJ86qen45VfwwxD']: 
      process.env.STOKE_DEV_ORG_ID || 'org_2yycYh2ig5m8LwgONhJfZGYhkm9',
  };
};

/**
 * Converts Clerk dev org ID to database production org ID.
 * Always applies mapping to ensure consistent org IDs in database.
 * This normalizes at write time so DB always has canonical (prod) org IDs.
 */
export function mapClerkIdToDbId(clerkOrgId: string): string {
  const mapping = getOrgIdMapping();
  const mappedId = mapping[clerkOrgId];

  if (mappedId) {
    console.log(`[orgIdMapping] Mapping Clerk ID ${clerkOrgId} -> DB ID ${mappedId}`);
    return mappedId;
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

// =============================================================================
// User ID Mapping (for chat sessions and other user-specific data)
// =============================================================================

// Environment-specific user ID mappings
// Dev Clerk User ID -> Production Database User ID
const getUserIdMapping = () => {
  return {
    // Matt's dev user -> prod user
    [process.env.MEDIAR_DEV_USER_ID || 'user_2yydIYhbpBpCzfgOIiNhOPFFhc4']:
      process.env.MEDIAR_PROD_USER_ID || 'user_2yynnCT0NQKgSvqMlHJHzBNg3Yo',
  };
};

// Reverse mapping for display purposes
// Production Database User ID -> Dev Clerk User ID
const getReverseUserIdMapping = () => {
  return {
    [process.env.MEDIAR_PROD_USER_ID || 'user_2yynnCT0NQKgSvqMlHJHzBNg3Yo']:
      process.env.MEDIAR_DEV_USER_ID || 'user_2yydIYhbpBpCzfgOIiNhOPFFhc4',
  };
};

/**
 * Converts Clerk dev user ID to database production user ID.
 * Always applies mapping to ensure consistent user IDs in database queries.
 */
export function mapClerkUserIdToDbUserId(clerkUserId: string): string {
  const mapping = getUserIdMapping();
  const mappedId = mapping[clerkUserId];

  if (mappedId) {
    console.log(`[userIdMapping] Mapping Clerk User ${clerkUserId} -> DB User ${mappedId}`);
    return mappedId;
  }

  return clerkUserId;
}

/**
 * Converts database production user ID back to Clerk dev user ID
 * Only applies mapping in development environment
 */
export function mapDbUserIdToClerkUserId(dbUserId: string): string {
  if (process.env.NODE_ENV === 'development') {
    const reverseMapping = getReverseUserIdMapping();
    const mappedId = reverseMapping[dbUserId];

    if (mappedId) {
      console.log(`[userIdMapping] Reverse mapping DB User ${dbUserId} -> Clerk User ${mappedId}`);
      return mappedId;
    }
  }

  return dbUserId;
}
