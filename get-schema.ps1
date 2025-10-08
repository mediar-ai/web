$headers = @{
  'apikey' = '***REMOVED***'
  'Authorization' = 'Bearer ***REMOVED***'
}

$machine = Invoke-RestMethod -Uri 'https://eshwntsgsputksqamckh.supabase.co/rest/v1/remote_machines?limit=1' -Method Get -Headers $headers

Write-Host "Remote machines table columns:" -ForegroundColor Cyan
$machine[0].PSObject.Properties | ForEach-Object {
  Write-Host "  $($_.Name): $($_.Value)" -ForegroundColor White
}
