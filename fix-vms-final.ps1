$headers = @{
  'apikey' = '***REMOVED***'
  'Authorization' = 'Bearer ***REMOVED***'
  'Content-Type' = 'application/json'
  'Prefer' = 'return=representation'
}

$workingVM = '172.171.215.84'

Write-Host "`n🔧 Updating ALL remote machines to: $workingVM`n" -ForegroundColor Yellow

# Get all machines
$machines = Invoke-RestMethod -Uri 'https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?select=*' -Method Get -Headers $headers

$updateBody = @{
  ip_address = $workingVM
  mcp_endpoint = "http://$workingVM:8080/mcp"
  health_endpoint = "http://$workingVM:8080/health"
  status = 'active'
  health_status = 'healthy'
} | ConvertTo-Json

$updated = 0
$failed = 0

foreach ($machine in $machines) {
  try {
    $result = Invoke-RestMethod -Uri "https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?id=eq.$($machine.id)" -Method Patch -Headers $headers -Body $updateBody
    Write-Host "  ✅ ID $($machine.id): $($machine.name)" -ForegroundColor Green
    $updated++
  } catch {
    Write-Host "  ❌ ID $($machine.id): $($machine.name) - $($_.Exception.Message)" -ForegroundColor Red
    $failed++
  }
}

Write-Host "`n📊 Summary:" -ForegroundColor Cyan
Write-Host "  Updated: $updated machines" -ForegroundColor Green
Write-Host "  Failed: $failed machines" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Gray' })
Write-Host "`n✅ All machines now point to: http://$workingVM:8080/mcp`n" -ForegroundColor Green
