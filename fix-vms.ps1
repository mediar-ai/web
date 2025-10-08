$headers = @{
  'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0'
  'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0'
  'Content-Type' = 'application/json'
  'Prefer' = 'return=representation'
}

$body = @{
  ip_address = '172.171.215.84'
  mcp_endpoint = 'http://172.171.215.84:8080/mcp'
  health_endpoint = 'http://172.171.215.84:8080/health'
  status = 'active'
  health_status = 'healthy'
} | ConvertTo-Json

Write-Host "Updating all remote machines to 172.171.215.84..." -ForegroundColor Yellow

try {
  $result = Invoke-RestMethod -Uri 'https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?id=neq.0' -Method Patch -Headers $headers -Body $body

  Write-Host "`n✅ Successfully updated remote machines!" -ForegroundColor Green
  Write-Host "`nUpdated machines:" -ForegroundColor Cyan
  $result | ForEach-Object {
    Write-Host "  ID $($_.id): $($_.name) -> $($_.mcp_endpoint)" -ForegroundColor White
  }
} catch {
  Write-Host "`n❌ Error updating machines:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
}
