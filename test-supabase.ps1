$headers = @{
  'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0'
  'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0'
}

Write-Host "Fetching remote machines..." -ForegroundColor Yellow
$machines = Invoke-RestMethod -Uri 'https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?select=*' -Method Get -Headers $headers

Write-Host "`nCurrent machines:" -ForegroundColor Cyan
$machines | ForEach-Object {
  Write-Host "ID $($_.id): $($_.name) -> $($_.mcp_endpoint)" -ForegroundColor White
}

Write-Host "`nTotal: $($machines.Count) machines" -ForegroundColor Green
