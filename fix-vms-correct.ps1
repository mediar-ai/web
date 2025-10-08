$headers = @{
  'apikey' = '***REMOVED***'
  'Authorization' = 'Bearer ***REMOVED***'
  'Content-Type' = 'application/json'
  'Prefer' = 'return=representation'
}

$workingVM = '172.171.215.84'

Write-Host "`n🔧 Updating ALL remote machines to: $workingVM`n" -ForegroundColor Yellow

$machines = Invoke-RestMethod -Uri 'https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?select=id,name,mcp_endpoint' -Method Get -Headers $headers

$updateBody = @{
  mcp_endpoint = "http://$workingVM:8080/mcp"
  health_endpoint = "http://$workingVM:8080/health"
  management_endpoint = "http://$workingVM:8080"
  status = 'active'
  health_status = 'healthy'
} | ConvertTo-Json

$updated = 0
$failed = 0

foreach ($machine in $machines) {
  try {
    Write-Host "Updating ID $($machine.id): $($machine.name)" -ForegroundColor Gray
    $result = Invoke-RestMethod -Uri "https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?id=eq.$($machine.id)" -Method Patch -Headers $headers -Body $updateBody
    Write-Host "  ✅ Success" -ForegroundColor Green
    $updated++
  } catch {
    Write-Host "  ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
  }
}

Write-Host "`n📊 Summary:" -ForegroundColor Cyan
Write-Host "  ✅ Updated: $updated machines" -ForegroundColor Green
Write-Host "  ❌ Failed: $failed machines" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Gray' })
Write-Host "`n🎉 All machines now point to: http://$workingVM:8080/mcp`n" -ForegroundColor Green
