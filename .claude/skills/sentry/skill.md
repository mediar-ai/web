---
name: sentry
description: Query Sentry for application errors, issues, and events. Auto-activates when user asks about errors, exceptions, crashes, or debugging production issues. Trigger words: "check sentry", "sentry errors", "production errors", "what's crashing", "error tracking", "show exceptions", "recent errors"
allowed-tools: Bash, Read
---

# Sentry Error Tracking Skill

Query Sentry issues for Mediar applications.

## Configuration

**Org:** `mediar-n5`
**Projects:**
- `mediar-desktop` - Desktop app (Tauri/Rust)
- `mediar-terminator-mcp` - MCP agent on VMs
- `executor` - Rust workflow executor

**Credentials:** Read `SENTRY_AUTH_TOKEN` from `.env.local`

---

## PowerShell Queries (Windows)

Use PowerShell for all queries since `jq` isn't available on Windows.

### List Projects

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$response = Invoke-RestMethod -Uri 'https://sentry.io/api/0/organizations/mediar-n5/projects/' -Headers $headers
$response | ForEach-Object { Write-Host \"[$($_.slug)] $($_.name) - $($_.platform)\" }
"
```

### Recent Unresolved Issues (All Projects)

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$response = Invoke-RestMethod -Uri 'https://sentry.io/api/0/organizations/mediar-n5/issues/?query=is:unresolved&sort=date&limit=15' -Headers $headers
$response | ForEach-Object { 
    Write-Host \"[$($_.shortId)] $($_.title)\"
    Write-Host \"  Events: $($_.count) | Last seen: $($_.lastSeen)\"
    Write-Host ''
}
"
```

### Issues for Specific Project

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$project = 'mediar-desktop'  # or: mediar-terminator-mcp, executor
$response = Invoke-RestMethod -Uri \"https://sentry.io/api/0/projects/mediar-n5/$project/issues/?query=is:unresolved&limit=15\" -Headers $headers
$response | ForEach-Object { 
    Write-Host \"[$($_.shortId)] $($_.title)\"
    Write-Host \"  Events: $($_.count) | Last: $($_.lastSeen)\"
}
"
```

### Production Issues Only

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$response = Invoke-RestMethod -Uri 'https://sentry.io/api/0/organizations/mediar-n5/issues/?query=is:unresolved+environment:production&limit=15' -Headers $headers
$response | ForEach-Object { 
    Write-Host \"[$($_.shortId)] $($_.title)\"
    Write-Host \"  Events: $($_.count) | Project: $($_.project.slug) | Last: $($_.lastSeen)\"
}
"
```

### Issues in Last 24 Hours

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$response = Invoke-RestMethod -Uri 'https://sentry.io/api/0/organizations/mediar-n5/issues/?query=is:unresolved+lastSeen:-24h&sort=freq&limit=20' -Headers $headers
$response | ForEach-Object { 
    Write-Host \"[$($_.shortId)] $($_.title)\"
    Write-Host \"  Events: $($_.count) | Users: $($_.userCount) | Project: $($_.project.slug)\"
}
"
```

### Get Issue Details

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$issueId = 'MEDIAR-DESKTOP-123'  # Replace with actual issue ID
$response = Invoke-RestMethod -Uri \"https://sentry.io/api/0/issues/$issueId/\" -Headers $headers
Write-Host \"Issue: $($response.shortId)\"
Write-Host \"Title: $($response.title)\"
Write-Host \"Culprit: $($response.culprit)\"
Write-Host \"Status: $($response.status)\"
Write-Host \"Events: $($response.count)\"
Write-Host \"Users: $($response.userCount)\"
Write-Host \"First: $($response.firstSeen)\"
Write-Host \"Last: $($response.lastSeen)\"
"
```

### Get Latest Event (Stack Trace)

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$issueId = 'MEDIAR-DESKTOP-123'  # Replace with actual issue ID
$response = Invoke-RestMethod -Uri \"https://sentry.io/api/0/issues/$issueId/events/latest/\" -Headers $headers
Write-Host \"Event: $($response.eventID)\"
Write-Host \"Message: $($response.message)\"
Write-Host \"Timestamp: $($response.dateCreated)\"
Write-Host ''
Write-Host 'Tags:'
$response.tags | ForEach-Object { Write-Host \"  $($_.key): $($_.value)\" }
Write-Host ''
Write-Host 'Full response (for stack trace):'
$response | ConvertTo-Json -Depth 10
"
```

---

## Write Operations (Ask First)

### Resolve an Issue

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\"; 'Content-Type' = 'application/json' }
$issueId = 'MEDIAR-DESKTOP-123'
$body = '{\"status\": \"resolved\"}'
$response = Invoke-RestMethod -Uri \"https://sentry.io/api/0/issues/$issueId/\" -Method PUT -Headers $headers -Body $body
Write-Host \"Resolved: $($response.shortId) - Status: $($response.status)\"
"
```

### Ignore an Issue

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\"; 'Content-Type' = 'application/json' }
$issueId = 'MEDIAR-DESKTOP-123'
$body = '{\"status\": \"ignored\"}'
$response = Invoke-RestMethod -Uri \"https://sentry.io/api/0/issues/$issueId/\" -Method PUT -Headers $headers -Body $body
Write-Host \"Ignored: $($response.shortId)\"
"
```

---

## Query Syntax

### Filters
- `is:unresolved` / `is:resolved` / `is:ignored`
- `environment:production` / `environment:staging`
- `lastSeen:-24h` / `lastSeen:-7d`
- `level:error` / `level:warning`

### Sort
- `sort=date` - Most recent
- `sort=freq` - Most frequent
- `sort=user` - Most users affected

### Examples
```
is:unresolved environment:production lastSeen:-24h
is:unresolved level:error sort:user
```

---

## Auto-Detect Org (If Needed)

If org slug is unknown, query `/organizations/` first:

```powershell
powershell -Command "
$token = (Get-Content .env.local | Where-Object { $_ -match '^SENTRY_AUTH_TOKEN=' }) -replace 'SENTRY_AUTH_TOKEN=', '' -replace '\"', ''
$headers = @{ 'Authorization' = \"Bearer $token\" }
$response = Invoke-RestMethod -Uri 'https://sentry.io/api/0/organizations/' -Headers $headers
$response | ForEach-Object { Write-Host \"[$($_.slug)] $($_.name)\" }
"
```
