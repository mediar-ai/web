SELECT id, name, github_folder, status, created_at 
FROM deployed_workflows 
WHERE github_folder = 'testgitsync' OR name LIKE '%test%git%'
ORDER BY created_at DESC 
LIMIT 5;
