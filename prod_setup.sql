-- =================================================================
-- !! DANGER !! - PRODUCTION MODE
-- =================================================================
-- This script sets the database to use the PRODUCTION Clerk
-- organization IDs. This should align with the keys used in your
-- production environment (e.g., on Vercel).
-- =================================================================

-- 1. Set Mediar org ID to the PROD ID
UPDATE organization_data_access
SET clerk_organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD' -- Mediar PROD ID
WHERE clerk_organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c'; -- Mediar DEV ID

-- 2. Set Stoke org ID to the PROD ID
UPDATE organization_data_access
SET clerk_organization_id = 'org_2yyo35c5YVUqjJ86qen45VfwwxD' -- Stoke PROD ID
WHERE clerk_organization_id = 'org_2yycYh2ig5m8LwgONhJfZGYhkm9'; -- Stoke DEV ID

-- 3. Set Stoke's users to the PROD ID
UPDATE mediar_users
SET organization_id = 'org_2yyo35c5YVUqjJ86qen45VfwwxD' -- Stoke PROD ID
WHERE organization_id = 'org_2yycYh2ig5m8LwgONhJfZGYhkm9'; -- Stoke DEV ID

-- 4. Verification
SELECT 'Database set to PRODUCTION mode.' as status;
SELECT clerk_organization_id, organization_name, data_access_scope FROM organization_data_access;
SELECT user_id, name, organization_id FROM mediar_users WHERE name IN ('Phil Esposito', 'Samuel W.'); 