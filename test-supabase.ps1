$headers = @{
  'apikey' = '***REMOVED***'
  'Authorization' = 'Bearer ***REMOVED***'
}

Write-Host "Fetching remote machines..." -ForegroundColor Yellow
$machines = Invoke-RestMethod -Uri 'https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?select=*' -Method Get -Headers $headers

Write-Host "`nCurrent machines:" -ForegroundColor Cyan
$machines | ForEach-Object {
  Write-Host "ID $($_.id): $($_.name) -> $($_.mcp_endpoint)" -ForegroundColor White
}

Write-Host "`nTotal: $($machines.Count) machines" -ForegroundColor Green
