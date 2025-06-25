-- =================================================================
-- !! DANGER !! - LOCAL DEVELOPMENT ONLY
-- =================================================================
-- This script resets the database to use the DEVELOPMENT Clerk
-- organization IDs. DO NOT RUN THIS ON A PRODUCTION DATABASE.
-- It is used to align your local database with the development
-- Clerk instance defined in your .env.local file.
-- =================================================================

-- 1. Reset Mediar org ID back to the DEV ID
UPDATE organization_data_access
SET clerk_organization_id = 'org_REDACTED' -- Mediar DEV ID
WHERE clerk_organization_id = 'org_REDACTED'; -- Mediar PROD ID

-- 2. Reset Example org ID back to the DEV ID
UPDATE organization_data_access
SET clerk_organization_id = 'org_REDACTED' -- Example DEV ID
WHERE clerk_organization_id = 'org_REDACTED'; -- Example PROD ID

-- 3. Reset Example's users back to the DEV ID
UPDATE mediar_users
SET organization_id = 'org_REDACTED' -- Example DEV ID
WHERE organization_id = 'org_REDACTED'; -- Example PROD ID

-- 4. Verification
SELECT 'Database reset to DEVELOPMENT mode.' as status;
SELECT clerk_organization_id, organization_name, data_access_scope FROM organization_data_access;
SELECT user_id, name, organization_id FROM mediar_users WHERE name IN ('Phil Esposito', 'Samuel W.'); 