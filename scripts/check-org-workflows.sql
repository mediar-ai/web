-- Check which organizations have workflows
SELECT
  clerk_organization_id,
  name,
  COUNT(w.id) as workflow_count
FROM organizations o
LEFT JOIN workflows w ON w.organization_id = o.id
GROUP BY o.id, o.clerk_organization_id, o.name
ORDER BY workflow_count DESC;

-- List all organizations from Supabase
SELECT
  id,
  clerk_organization_id,
  name,
  created_at
FROM organizations
ORDER BY created_at DESC;
