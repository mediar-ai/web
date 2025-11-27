---
name: azure-vm
description: Map Supabase machine names/IDs to Azure VM names for Azure CLI commands. Auto-activates when user says "azure vm", "stop vm", "start vm", "az vm", "which azure", "azure cli", "resource group", or needs to run Azure commands on a machine.
allowed-tools: Bash, Read
---

# Azure VM Lookup Skill

Map Supabase remote machine names/IDs to Azure VM details for CLI commands.

---

## Quick Lookup by Machine ID

```bash
cat > /tmp/azure_lookup.sh << 'EOF'
#!/bin/bash
cd "C:/Users/louis/Documents/mediar-web-app"
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
MACHINE_ID=${1:-22}

RESULT=$(curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,azure_resource_id&id=eq.${MACHINE_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}")

NAME=$(echo "$RESULT" | jq -r '.[0].name')
AZURE_ID=$(echo "$RESULT" | jq -r '.[0].azure_resource_id')
MCP=$(echo "$RESULT" | jq -r '.[0].mcp_endpoint')
IP=$(echo "$MCP" | sed -E 's|https?://([^:/]+).*|\1|')

if [ "$AZURE_ID" == "null" ] || [ -z "$AZURE_ID" ]; then
  echo "Machine $MACHINE_ID: $NAME"
  echo "IP: $IP"
  echo "No Azure resource ID set - cannot generate Azure CLI commands"
  exit 1
fi

# Parse Azure resource ID: /subscriptions/.../resourceGroups/{RG}/providers/Microsoft.Compute/virtualMachines/{VM}
RG=$(echo "$AZURE_ID" | sed -E 's|.*/resourceGroups/([^/]+)/.*|\1|')
VM=$(echo "$AZURE_ID" | sed -E 's|.*/virtualMachines/(.*)|\1|')

echo "=== Machine $MACHINE_ID: $NAME ==="
echo "IP: $IP"
echo "Resource Group: $RG"
echo "VM Name: $VM"
echo ""
echo "=== Azure CLI Commands ==="
echo "# Stop MCP service (for RDP access):"
echo "az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts \"Stop-Service -Name terminator-mcp -Force\""
echo ""
echo "# Start MCP service:"
echo "az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts \"Start-Service -Name terminator-mcp\""
echo ""
echo "# Restart VM:"
echo "az vm restart --resource-group $RG --name $VM"
echo ""
echo "# Check VM status:"
echo "az vm get-instance-view --resource-group $RG --name $VM --query instanceView.statuses"
echo ""
echo "# Run any PowerShell:"
echo "az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts \"<YOUR_SCRIPT>\""
EOF
bash /tmp/azure_lookup.sh 22
```

---

## List All Machines with Azure IDs

```bash
cat > /tmp/list_azure.sh << 'EOF'
#!/bin/bash
cd "C:/Users/louis/Documents/mediar-web-app"
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,azure_resource_id&azure_resource_id=not.is.null&order=id" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] |
    "[\(.id)] \(.name)\n    RG: " + (.azure_resource_id | split("/") | .[4]) +
    "\n    VM: " + (.azure_resource_id | split("/") | .[8]) +
    "\n    IP: " + (.mcp_endpoint | gsub("https?://"; "") | split(":")[0]) + "\n"'
EOF
bash /tmp/list_azure.sh
```

---

## Search by Name

```bash
cat > /tmp/azure_search.sh << 'EOF'
#!/bin/bash
cd "C:/Users/louis/Documents/mediar-web-app"
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
SEARCH="${1:-imperial}"

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,azure_resource_id&name=ilike.*${SEARCH}*" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
EOF
bash /tmp/azure_search.sh "imperial"
```

---

## Known Machine Mappings

| ID | Supabase Name | Azure RG | Azure VM | IP |
|----|---------------|----------|----------|-----|
| 18 | Private dev machine | mcp-s3-mount-test | vm1 | - |
| 21 | Public beta dev machine | mcp-vm2-rg | vm2 | - |
| 22 | ExampleClient infra v2 | ExampleClient-rg | example-vm1 | 40.76.118.115 |

---

## Common Operations

### Stop MCP Service (for RDP)
```bash
# Machine 22 (ExampleClient)
az vm run-command invoke --resource-group ExampleClient-rg --name example-vm1 --command-id RunPowerShellScript --scripts "Stop-Service -Name terminator-mcp -Force"
```

### Start MCP Service
```bash
az vm run-command invoke --resource-group ExampleClient-rg --name example-vm1 --command-id RunPowerShellScript --scripts "Start-Service -Name terminator-mcp"
```

### Restart MCP Service
```bash
az vm run-command invoke --resource-group ExampleClient-rg --name example-vm1 --command-id RunPowerShellScript --scripts "Restart-Service -Name terminator-mcp"
```

### Check MCP Service Status
```bash
az vm run-command invoke --resource-group ExampleClient-rg --name example-vm1 --command-id RunPowerShellScript --scripts "Get-Service terminator-mcp | Select-Object Status, Name"
```

### Reinstall OneDrive
```bash
az vm run-command invoke --resource-group ExampleClient-rg --name example-vm1 --command-id RunPowerShellScript --scripts "Start-Process 'https://go.microsoft.com/fwlink/?linkid=844652' -Wait; Start-Sleep 60"
```

---

## RDP Credentials

Default VM credentials (from Packer image):
- **Username:** `vmuser`
- **Password:** `P@ssw0rd123!`

RDP connection: `mstsc /v:<IP>:3389`
