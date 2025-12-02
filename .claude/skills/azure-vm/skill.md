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
ENV_FILE=".env.local"
SUPABASE_URL=$(grep "^SUPABASE_URL=" "$ENV_FILE" | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" "$ENV_FILE" | cut -d '=' -f2 | tr -d '"')
MACHINE_ID=22  # Change this

RESULT=$(curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,azure_resource_id&id=eq.${MACHINE_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}")

NAME=$(echo "$RESULT" | jq -r '.[0].name')
AZURE_ID=$(echo "$RESULT" | jq -r '.[0].azure_resource_id')
MCP=$(echo "$RESULT" | jq -r '.[0].mcp_endpoint')
IP=$(echo "$MCP" | sed -E 's|https?://([^:/]+).*|\1|')

# Parse Azure resource ID
RG=$(echo "$AZURE_ID" | sed -E 's|.*/resourceGroups/([^/]+)/.*|\1|')
VM=$(echo "$AZURE_ID" | sed -E 's|.*/virtualMachines/(.*)|\1|')

echo "=== Machine $MACHINE_ID: $NAME ==="
echo "IP: $IP"
echo "Resource Group: $RG"
echo "VM Name: $VM"
```

---

## List All Machines with Azure IDs

```bash
ENV_FILE=".env.local"
SUPABASE_URL=$(grep "^SUPABASE_URL=" "$ENV_FILE" | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" "$ENV_FILE" | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,azure_resource_id&azure_resource_id=not.is.null&order=id" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] |
    "[\(.id)] \(.name)\n    RG: " + (.azure_resource_id | split("/") | .[4]) +
    "\n    VM: " + (.azure_resource_id | split("/") | .[8]) +
    "\n    IP: " + (.mcp_endpoint | gsub("https?://"; "") | split(":")[0]) + "\n"'
```

---

## Common Operations

### Stop MCP Service (for RDP)
```bash
az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts "Stop-Service -Name terminator-mcp -Force"
```

### Start MCP Service
```bash
az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts "Start-Service -Name terminator-mcp"
```

### Restart MCP Service
```bash
az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts "Restart-Service -Name terminator-mcp"
```

### Check MCP Service Status
```bash
az vm run-command invoke --resource-group $RG --name $VM --command-id RunPowerShellScript --scripts "Get-Service terminator-mcp | Select-Object Status, Name"
```

### Restart VM
```bash
az vm restart --resource-group $RG --name $VM
```

### Check VM Status
```bash
az vm get-instance-view --resource-group $RG --name $VM --query instanceView.statuses
```

---

## RDP Connection

Use the "Quick Lookup by Machine ID" script above to get RG/VM/IP, then:
```bash
mstsc /v:<IP>:3389
```

Default credentials are in the Packer image config.
