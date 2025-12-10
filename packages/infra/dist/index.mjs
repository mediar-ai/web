// src/azure/types.ts
var POWER_STATE_MAP = {
  "PowerState/running": "running",
  "PowerState/deallocated": "deallocated",
  "PowerState/stopped": "stopped",
  "PowerState/starting": "starting",
  "PowerState/stopping": "stopping",
  "PowerState/deallocating": "deallocating"
};
var VNC_GATEWAY_URL = "https://vnc-gateway-e4mtrji55a-ue.a.run.app";

// src/azure/resource-parser.ts
var AzureResourceParseError = class extends Error {
  constructor(message, resourceId) {
    super(message);
    this.resourceId = resourceId;
    this.name = "AzureResourceParseError";
  }
};
function parseAzureResourceId(resourceId) {
  if (!resourceId) {
    throw new AzureResourceParseError("Resource ID is empty", resourceId);
  }
  const parts = resourceId.split("/");
  const subscriptionIndex = parts.indexOf("subscriptions");
  const rgIndex = parts.indexOf("resourceGroups");
  if (subscriptionIndex === -1) {
    throw new AzureResourceParseError(
      "Invalid Azure Resource ID: missing subscriptions segment",
      resourceId
    );
  }
  if (rgIndex === -1) {
    throw new AzureResourceParseError(
      "Invalid Azure Resource ID: missing resourceGroups segment",
      resourceId
    );
  }
  const subscriptionId = parts[subscriptionIndex + 1];
  const resourceGroup = parts[rgIndex + 1];
  if (!subscriptionId || !resourceGroup) {
    throw new AzureResourceParseError(
      "Invalid Azure Resource ID: missing subscription or resource group value",
      resourceId
    );
  }
  const providersIndex = parts.indexOf("providers");
  let provider;
  let resourceType;
  let resourceName;
  if (providersIndex !== -1) {
    provider = parts[providersIndex + 1];
    resourceType = parts[providersIndex + 2];
    resourceName = parts[providersIndex + 3];
  } else {
    resourceName = parts[parts.length - 1];
  }
  if (!resourceName) {
    throw new AzureResourceParseError(
      "Invalid Azure Resource ID: missing resource name",
      resourceId
    );
  }
  return {
    subscriptionId,
    resourceGroup,
    provider,
    resourceType,
    resourceName
  };
}
function parseAzureVmResourceId(resourceId) {
  const parsed = parseAzureResourceId(resourceId);
  const parts = resourceId.split("/");
  const vmIndex = parts.indexOf("virtualMachines");
  if (vmIndex === -1) {
    throw new AzureResourceParseError(
      "Invalid Azure VM Resource ID: not a virtualMachines resource",
      resourceId
    );
  }
  const vmName = parts[vmIndex + 1];
  if (!vmName) {
    throw new AzureResourceParseError(
      "Invalid Azure VM Resource ID: missing VM name",
      resourceId
    );
  }
  return {
    subscriptionId: parsed.subscriptionId,
    resourceGroup: parsed.resourceGroup,
    provider: "Microsoft.Compute",
    resourceType: "virtualMachines",
    resourceName: vmName
  };
}
function buildAzureResourceId(resource) {
  let id = `/subscriptions/${resource.subscriptionId}/resourceGroups/${resource.resourceGroup}`;
  if (resource.provider && resource.resourceType) {
    id += `/providers/${resource.provider}/${resource.resourceType}/${resource.resourceName}`;
  }
  return id;
}
function buildAzureVmResourceId(subscriptionId, resourceGroup, vmName) {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
}
function extractHostFromEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.hostname;
  } catch {
    return null;
  }
}
function isValidAzureResourceId(resourceId) {
  try {
    parseAzureResourceId(resourceId);
    return true;
  } catch {
    return false;
  }
}
function isValidAzureVmResourceId(resourceId) {
  try {
    parseAzureVmResourceId(resourceId);
    return true;
  } catch {
    return false;
  }
}

// src/azure/client.ts
import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { ClientSecretCredential, DefaultAzureCredential } from "@azure/identity";
var computeClient = null;
var networkClient = null;
var credential = null;
function getSubscriptionId() {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    throw new Error(
      "AZURE_SUBSCRIPTION_ID environment variable is not set. Please set it to your Azure subscription ID."
    );
  }
  return subscriptionId;
}
function getAzureCredential() {
  if (!credential) {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;
    if (clientId && clientSecret && tenantId) {
      console.log("[Azure] Using ClientSecretCredential (service principal)");
      credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    } else {
      console.log("[Azure] Using DefaultAzureCredential (local dev mode)");
      credential = new DefaultAzureCredential();
    }
  }
  return credential;
}
function getComputeClient() {
  if (!computeClient) {
    const subscriptionId = getSubscriptionId();
    const cred = getAzureCredential();
    computeClient = new ComputeManagementClient(cred, subscriptionId);
  }
  return computeClient;
}
function getNetworkClient() {
  if (!networkClient) {
    const subscriptionId = getSubscriptionId();
    const cred = getAzureCredential();
    networkClient = new NetworkManagementClient(cred, subscriptionId);
  }
  return networkClient;
}
function getComputeClientForSubscription(subscriptionId) {
  const cred = getAzureCredential();
  return new ComputeManagementClient(cred, subscriptionId);
}
function isAzureConfigured() {
  try {
    getSubscriptionId();
    return true;
  } catch {
    return false;
  }
}
function resetClients() {
  computeClient = null;
  networkClient = null;
  credential = null;
}

// src/telemetry/index.ts
import { trace, context, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
var InfraAttributes = {
  // Operation attributes
  OPERATION_TYPE: "infra.operation.type",
  OPERATION_STATUS: "infra.operation.status",
  // Actor attributes
  ACTOR_ID: "infra.actor.id",
  ACTOR_TYPE: "infra.actor.type",
  // 'user' | 'cli' | 'api' | 'system'
  // Resource attributes
  RESOURCE_TYPE: "infra.resource.type",
  // 'vm' | 'image' | 'image_template'
  RESOURCE_ID: "infra.resource.id",
  RESOURCE_NAME: "infra.resource.name",
  // Azure-specific attributes
  AZURE_SUBSCRIPTION_ID: "azure.subscription.id",
  AZURE_RESOURCE_GROUP: "azure.resource_group",
  AZURE_REGION: "azure.region",
  AZURE_VM_SIZE: "azure.vm.size",
  // VM operation attributes
  VM_POWER_STATE: "azure.vm.power_state",
  VM_PROVISIONING_STATE: "azure.vm.provisioning_state",
  VM_PUBLIC_IP: "azure.vm.public_ip",
  // Image operation attributes
  IMAGE_NAME: "azure.image.name",
  IMAGE_VERSION: "azure.image.version",
  IMAGE_GALLERY: "azure.image.gallery",
  // Error attributes
  ERROR_TYPE: "error.type",
  ERROR_MESSAGE: "error.message"
};
var sdk = null;
var tracer = null;
function initTelemetry(options) {
  const otlpEndpoint = options?.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
  const exporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`
  });
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options?.serviceName || "mediar-infra",
      [ATTR_SERVICE_VERSION]: options?.serviceVersion || "0.1.0",
      "deployment.environment": process.env.NODE_ENV || "development"
    }),
    spanProcessor: new BatchSpanProcessor(exporter)
  });
  sdk.start();
  tracer = trace.getTracer("mediar-infra");
  console.log(`[Telemetry] Initialized, exporting to ${otlpEndpoint}`);
}
async function shutdownTelemetry() {
  if (sdk) {
    await sdk.shutdown();
    console.log("[Telemetry] Shutdown complete");
  }
}
function getTracer() {
  if (!tracer) {
    initTelemetry();
    tracer = trace.getTracer("mediar-infra");
  }
  return tracer;
}
function startInfraSpan(name, attributes) {
  const tracer2 = getTracer();
  const span = tracer2.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [InfraAttributes.OPERATION_TYPE]: attributes.operation,
      [InfraAttributes.ACTOR_ID]: attributes.actor,
      [InfraAttributes.ACTOR_TYPE]: attributes.actorType,
      [InfraAttributes.RESOURCE_TYPE]: attributes.resourceType,
      ...attributes.resourceId && { [InfraAttributes.RESOURCE_ID]: attributes.resourceId },
      ...attributes.resourceName && { [InfraAttributes.RESOURCE_NAME]: attributes.resourceName },
      ...attributes.subscriptionId && { [InfraAttributes.AZURE_SUBSCRIPTION_ID]: attributes.subscriptionId },
      ...attributes.resourceGroup && { [InfraAttributes.AZURE_RESOURCE_GROUP]: attributes.resourceGroup },
      ...attributes.region && { [InfraAttributes.AZURE_REGION]: attributes.region },
      ...attributes.vmSize && { [InfraAttributes.AZURE_VM_SIZE]: attributes.vmSize },
      ...attributes.imageName && { [InfraAttributes.IMAGE_NAME]: attributes.imageName },
      ...attributes.imageVersion && { [InfraAttributes.IMAGE_VERSION]: attributes.imageVersion }
    }
  });
  return span;
}
function recordSuccess(span, attributes) {
  span.setStatus({ code: SpanStatusCode.OK });
  span.setAttribute(InfraAttributes.OPERATION_STATUS, "success");
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }
  span.end();
}
function recordFailure(span, error, errorType) {
  const errorMessage = error instanceof Error ? error.message : error;
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: errorMessage
  });
  span.setAttribute(InfraAttributes.OPERATION_STATUS, "failed");
  span.setAttribute(InfraAttributes.ERROR_MESSAGE, errorMessage);
  if (errorType) {
    span.setAttribute(InfraAttributes.ERROR_TYPE, errorType);
  }
  if (error instanceof Error && error.stack) {
    span.recordException(error);
  }
  span.end();
}
function addSpanEvent(span, name, attributes) {
  span.addEvent(name, attributes);
}
async function withSpan(name, attributes, fn) {
  const span = startInfraSpan(name, attributes);
  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    recordSuccess(span, {
      ...typeof result === "object" && result !== null && "success" in result ? { result_success: result.success } : {}
    });
    return result;
  } catch (error) {
    recordFailure(span, error instanceof Error ? error : String(error));
    throw error;
  }
}
function createAuditContext(actor, actorType) {
  return { actor, actorType };
}

// src/azure/vm-operations.ts
var DEFAULT_AUDIT_CONTEXT = {
  actor: "system",
  actorType: "system"
};
async function getVmState(resourceIdOrName, resourceGroup) {
  const computeClient2 = getComputeClient();
  let vmName;
  let rg;
  if (resourceIdOrName.startsWith("/subscriptions/")) {
    const parsed = parseAzureVmResourceId(resourceIdOrName);
    vmName = parsed.resourceName;
    rg = parsed.resourceGroup;
  } else {
    vmName = resourceIdOrName;
    rg = resourceGroup || "";
  }
  const vm = await computeClient2.virtualMachines.instanceView(rg, vmName);
  const statuses = vm.statuses || [];
  let powerState = "unknown";
  let provisioningState = "unknown";
  for (const status of statuses) {
    if (status.code?.startsWith("PowerState/")) {
      powerState = POWER_STATE_MAP[status.code] || "unknown";
    }
    if (status.code?.startsWith("ProvisioningState/")) {
      provisioningState = status.code.replace("ProvisioningState/", "");
    }
  }
  const vmExtensions = vm.extensions || [];
  const blockedExtensions = vmExtensions.filter((ext) => ext.statuses?.some((s) => s.level === "Error")).map((ext) => ext.name || "unknown");
  return {
    powerState,
    provisioningState,
    extensionsReady: blockedExtensions.length === 0,
    blockedExtensions,
    lastUpdated: /* @__PURE__ */ new Date()
  };
}
async function startVm(resourceId, auditContext = DEFAULT_AUDIT_CONTEXT) {
  const parsed = parseAzureVmResourceId(resourceId);
  return withSpan(
    "vm.start",
    {
      operation: "vm.start",
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: "vm",
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup
    },
    async (span) => {
      addSpanEvent(span, "starting_vm");
      const computeClient2 = getComputeClient();
      const poller = await computeClient2.virtualMachines.beginStart(
        parsed.resourceGroup,
        parsed.resourceName
      );
      addSpanEvent(span, "polling_operation");
      await poller.pollUntilDone();
      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);
      return {
        success: true,
        operationId: `start-${Date.now()}`,
        message: `VM ${parsed.resourceName} started successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state
      };
    }
  );
}
async function stopVm(resourceId, auditContext = DEFAULT_AUDIT_CONTEXT) {
  const parsed = parseAzureVmResourceId(resourceId);
  return withSpan(
    "vm.stop",
    {
      operation: "vm.stop",
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: "vm",
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup
    },
    async (span) => {
      addSpanEvent(span, "stopping_vm");
      const computeClient2 = getComputeClient();
      const poller = await computeClient2.virtualMachines.beginPowerOff(
        parsed.resourceGroup,
        parsed.resourceName
      );
      addSpanEvent(span, "polling_operation");
      await poller.pollUntilDone();
      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);
      return {
        success: true,
        operationId: `stop-${Date.now()}`,
        message: `VM ${parsed.resourceName} stopped successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state
      };
    }
  );
}
async function deallocateVm(resourceId, auditContext = DEFAULT_AUDIT_CONTEXT) {
  const parsed = parseAzureVmResourceId(resourceId);
  return withSpan(
    "vm.deallocate",
    {
      operation: "vm.deallocate",
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: "vm",
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup
    },
    async (span) => {
      addSpanEvent(span, "deallocating_vm");
      const computeClient2 = getComputeClient();
      const poller = await computeClient2.virtualMachines.beginDeallocate(
        parsed.resourceGroup,
        parsed.resourceName
      );
      addSpanEvent(span, "polling_operation");
      await poller.pollUntilDone();
      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);
      return {
        success: true,
        operationId: `deallocate-${Date.now()}`,
        message: `VM ${parsed.resourceName} deallocated successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state
      };
    }
  );
}
async function restartVm(resourceId, auditContext = DEFAULT_AUDIT_CONTEXT) {
  const parsed = parseAzureVmResourceId(resourceId);
  return withSpan(
    "vm.restart",
    {
      operation: "vm.restart",
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: "vm",
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup
    },
    async (span) => {
      addSpanEvent(span, "restarting_vm");
      const computeClient2 = getComputeClient();
      const poller = await computeClient2.virtualMachines.beginRestart(
        parsed.resourceGroup,
        parsed.resourceName
      );
      addSpanEvent(span, "polling_operation");
      await poller.pollUntilDone();
      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);
      return {
        success: true,
        operationId: `restart-${Date.now()}`,
        message: `VM ${parsed.resourceName} restarted successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state
      };
    }
  );
}
async function runCommand(resourceId, options, auditContext = DEFAULT_AUDIT_CONTEXT) {
  const parsed = parseAzureVmResourceId(resourceId);
  return withSpan(
    "vm.run_command",
    {
      operation: "vm.run_command",
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: "vm",
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
      script_lines: options.script.length
    },
    async (span) => {
      addSpanEvent(span, "executing_command", { script_lines: options.script.length });
      const computeClient2 = getComputeClient();
      const timeout = options.timeoutMs || 12e4;
      const poller = await computeClient2.virtualMachines.beginRunCommand(
        parsed.resourceGroup,
        parsed.resourceName,
        {
          commandId: "RunPowerShellScript",
          script: options.script,
          parameters: options.parameters ? Object.entries(options.parameters).map(([name, value]) => ({ name, value })) : void 0
        }
      );
      const timeoutPromise = new Promise(
        (_, reject) => setTimeout(() => reject(new Error("Command timeout")), timeout)
      );
      try {
        const result = await Promise.race([poller.pollUntilDone(), timeoutPromise]);
        const output = result.value?.[0]?.message || "";
        const exitCode = output.includes("ERROR") ? 1 : 0;
        span.setAttribute("command.exit_code", exitCode);
        span.setAttribute("command.output_length", output.length);
        return {
          success: exitCode === 0,
          output,
          timedOut: false,
          exitCode
        };
      } catch (error) {
        if (error instanceof Error && error.message === "Command timeout") {
          span.setAttribute("command.timed_out", true);
          return {
            success: false,
            output: "",
            timedOut: true
          };
        }
        throw error;
      }
    }
  );
}
async function isVmReady(resourceId) {
  const state = await getVmState(resourceId);
  return state.powerState === "running" && state.extensionsReady;
}
async function getVmPublicIp(resourceId) {
  const parsed = parseAzureVmResourceId(resourceId);
  const computeClient2 = getComputeClient();
  const networkClient2 = getNetworkClient();
  const vm = await computeClient2.virtualMachines.get(
    parsed.resourceGroup,
    parsed.resourceName
  );
  const nicRef = vm.networkProfile?.networkInterfaces?.[0];
  if (!nicRef?.id) return null;
  const nicName = nicRef.id.split("/").pop();
  if (!nicName) return null;
  const nic = await networkClient2.networkInterfaces.get(
    parsed.resourceGroup,
    nicName
  );
  const ipConfigRef = nic.ipConfigurations?.[0]?.publicIPAddress;
  if (!ipConfigRef?.id) return null;
  const ipName = ipConfigRef.id.split("/").pop();
  if (!ipName) return null;
  const publicIp = await networkClient2.publicIPAddresses.get(
    parsed.resourceGroup,
    ipName
  );
  return publicIp.ipAddress || null;
}

// src/azure/image-builder.ts
import { ImageBuilderClient } from "@azure/arm-imagebuilder";
import { ComputeManagementClient as ComputeManagementClient2 } from "@azure/arm-compute";
var IMAGE_CONFIG = {
  location: "eastus",
  resourceGroup: "UI-AUTOMATION-IMAGES-RG",
  galleryName: "mcpimages",
  galleryImageName: "mcp-full",
  vmSize: "Standard_D4s_v3",
  // Base image: Windows Server 2022 Datacenter
  baseImagePublisher: "MicrosoftWindowsServer",
  baseImageOffer: "WindowsServer",
  baseImageSku: "2022-datacenter-g2"
};
var IMAGE_BUILDER_IDENTITY = "/subscriptions/{subscriptionId}/resourcegroups/UI-AUTOMATION-IMAGES-RG/providers/Microsoft.ManagedIdentity/userAssignedIdentities/image-builder-identity";
var imageBuilderClient = null;
function getImageBuilderClient() {
  if (!imageBuilderClient) {
    const subscriptionId = getSubscriptionId();
    const credential2 = getAzureCredential();
    imageBuilderClient = new ImageBuilderClient(credential2, subscriptionId);
  }
  return imageBuilderClient;
}
function generateProvisioningScript(options) {
  const s3Endpoint = options.s3Endpoint || "https://eshwntsgsputksqamckh.storage.supabase.co/storage/v1/s3";
  return `
# Enable TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Store credentials for later use
$vmPassword = '${options.vmPassword}'
$vncPassword = '${options.vncPassword}'
$s3AccessKey = '${options.s3AccessKey || ""}'
$s3SecretKey = '${options.s3SecretKey || ""}'
$s3Endpoint = '${s3Endpoint}'

# ==============================================================================
# 1. Create Directories
# ==============================================================================
Write-Host 'Creating directories...'
New-Item -ItemType Directory -Force -Path C:\\MCP
New-Item -ItemType Directory -Force -Path C:\\MCP\\logs
New-Item -ItemType Directory -Force -Path C:\\Temp
New-Item -ItemType Directory -Force -Path C:\\Scripts
New-Item -ItemType Directory -Force -Path C:\\Workflows

# ==============================================================================
# 2. Install MCP Agent
# ==============================================================================
Write-Host 'Fetching latest MCP agent version...'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/mediar-ai/terminator/releases/latest'
$version = $release.tag_name
Write-Host "Downloading MCP agent $version..."
$asset = $release.assets | Where-Object { $_.name -like '*terminator-mcp-agent-win32-x64-msvc.zip' }
$url = $asset.browser_download_url
Invoke-WebRequest -Uri $url -OutFile 'C:\\Temp\\mcp-agent.zip' -UseBasicParsing
Expand-Archive -Path 'C:\\Temp\\mcp-agent.zip' -DestinationPath C:\\MCP -Force
Remove-Item 'C:\\Temp\\mcp-agent.zip'

# ==============================================================================
# 3. Install Node.js & terminator.js
# ==============================================================================
Write-Host 'Installing Node.js...'
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile 'C:\\Temp\\node.msi' -UseBasicParsing
Start-Process msiexec.exe -ArgumentList '/i', 'C:\\Temp\\node.msi', '/quiet', '/norestart' -Wait
Remove-Item 'C:\\Temp\\node.msi'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host 'Pre-installing terminator.js...'
$mcpDir = 'C:\\Users\\vmuser\\AppData\\Local\\Temp\\terminator_mcp_persistent'
New-Item -ItemType Directory -Force -Path $mcpDir
Set-Location $mcpDir
$packageJson = @{ name = 'terminator-mcp-persistent'; version = '1.0.0'; dependencies = @{ 'terminator.js' = 'latest'; tsx = '^4.7.0'; typescript = '^5.3.0'; '@types/node' = '^20.0.0' } } | ConvertTo-Json -Depth 10
$packageJson | Out-File -FilePath 'package.json' -Encoding UTF8
npm install
Set-Location C:\\

# ==============================================================================
# 4. Install Chocolatey
# ==============================================================================
Write-Host 'Installing Chocolatey...'
Set-ExecutionPolicy Bypass -Scope Process -Force
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

# ==============================================================================
# 5. Install Bun
# ==============================================================================
Write-Host 'Installing Bun...'
Invoke-WebRequest -Uri 'https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip' -OutFile 'C:\\Temp\\bun.zip' -UseBasicParsing
Expand-Archive -Path 'C:\\Temp\\bun.zip' -DestinationPath 'C:\\Temp\\bun-extract' -Force
New-Item -ItemType Directory -Force -Path 'C:\\MCP\\bun' | Out-Null
$bunExe = Get-ChildItem -Path 'C:\\Temp\\bun-extract' -Filter 'bun.exe' -Recurse | Select-Object -First 1
Copy-Item -Path $bunExe.FullName -Destination 'C:\\MCP\\bun\\bun.exe' -Force
Remove-Item 'C:\\Temp\\bun.zip'
Remove-Item 'C:\\Temp\\bun-extract' -Recurse -Force
$existingPath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($existingPath -notlike '*C:\\MCP\\bun*') {
  [System.Environment]::SetEnvironmentVariable('Path', "$existingPath;C:\\MCP\\bun", 'Machine')
}

# ==============================================================================
# 6. Install Tools via Chocolatey
# ==============================================================================
Write-Host 'Installing rclone, ffmpeg, chrome...'
choco install -y rclone ffmpeg googlechrome --ignore-checksums

# ==============================================================================
# 7. Configure Chrome (full config matching Packer)
# ==============================================================================
Write-Host 'Configuring Chrome...'
$chromePoliciesPath = 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome'
New-Item -Path $chromePoliciesPath -Force | Out-Null
Set-ItemProperty -Path $chromePoliciesPath -Name 'SuppressFirstRunBubble' -Value 1 -Type DWord
Set-ItemProperty -Path $chromePoliciesPath -Name 'DefaultBrowserSettingEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $chromePoliciesPath -Name 'MetricsReportingEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $chromePoliciesPath -Name 'PasswordManagerEnabled' -Value 0 -Type DWord

$chromeUserDataPath = 'C:\\Users\\vmuser\\AppData\\Local\\Google\\Chrome\\User Data'
$chromeDefaultPath = "$chromeUserDataPath\\Default"
New-Item -ItemType Directory -Force -Path $chromeDefaultPath | Out-Null
New-Item -ItemType File -Force -Path "$chromeUserDataPath\\First Run" | Out-Null

# Create Local State to mark first run as complete
$localState = @{
    browser = @{
        has_seen_welcome_page = $true
        should_reset_check_default_browser = $false
    }
}
$localState | ConvertTo-Json -Depth 10 | Out-File -FilePath "$chromeUserDataPath\\Local State" -Encoding UTF8

# Create Preferences to skip first-run dialogs
$chromePrefs = @{
    browser = @{
        show_home_button = $false
        check_default_browser = $false
    }
    credentials_enable_service = $false
    signin = @{
        allowed_on_next_startup = $false
    }
}
$chromePrefs | ConvertTo-Json -Depth 10 | Out-File -FilePath "$chromeDefaultPath\\Preferences" -Encoding UTF8

# Install Terminator extension
Write-Host 'Installing Terminator extension...'
try {
  Invoke-WebRequest -Uri 'https://github.com/mediar-ai/terminator/releases/latest/download/terminator-extension.zip' -OutFile 'C:\\Temp\\ext.zip' -UseBasicParsing
  Expand-Archive -Path 'C:\\Temp\\ext.zip' -DestinationPath 'C:\\MCP\\terminator-extension' -Force
  Remove-Item 'C:\\Temp\\ext.zip' -Force
} catch { Write-Host "Extension download failed: $_" }

# ==============================================================================
# 8. Install WinFsp
# ==============================================================================
Write-Host 'Installing WinFsp...'
Invoke-WebRequest -Uri 'https://github.com/winfsp/winfsp/releases/download/v2.0/winfsp-2.0.23075.msi' -OutFile 'C:\\Temp\\winfsp.msi' -UseBasicParsing
Start-Process msiexec.exe -ArgumentList '/i', 'C:\\Temp\\winfsp.msi', '/quiet', '/norestart' -Wait
Remove-Item 'C:\\Temp\\winfsp.msi' -Force

# ==============================================================================
# 9. Configure rclone
# ==============================================================================
if ($s3AccessKey -and $s3SecretKey) {
  Write-Host 'Configuring rclone...'
  $rcloneConfigDir = "$env:ProgramData\\rclone"
  New-Item -ItemType Directory -Path $rcloneConfigDir -Force | Out-Null
  @"
[s3]
type = s3
provider = Other
access_key_id = $s3AccessKey
secret_access_key = $s3SecretKey
region = us-west-1
endpoint = $s3Endpoint
"@ | Out-File -FilePath "$rcloneConfigDir\\rclone.conf" -Encoding ASCII
}

# ==============================================================================
# 10. Create S3 Mount Script (matching Packer)
# ==============================================================================
Write-Host 'Creating S3 mount script...'
@'
# Mount S3 bucket as S: drive using rclone
$rclonePath = (Get-Command rclone -ErrorAction SilentlyContinue).Path
if (-not $rclonePath) {
    $rclonePath = "C:\\ProgramData\\chocolatey\\bin\\rclone.exe"
}

# Check if S: is already mounted
if (Test-Path S:\\) {
    Write-Host "S: drive already mounted"
    exit 0
}

# Mount with network mode for better cross-process access
$mountArgs = @(
    "mount",
    "s3:",
    "S:",
    "--vfs-cache-mode", "full",
    "--vfs-cache-max-age", "1h",
    "--vfs-read-chunk-size", "64M",
    "--vfs-read-chunk-size-limit", "512M",
    "--buffer-size", "64M",
    "--dir-cache-time", "30s",
    "--poll-interval", "15s",
    "--config", "C:\\ProgramData\\rclone\\rclone.conf",
    "--network-mode",
    "--volname", "MediarS3"
)

Start-Process -FilePath $rclonePath -ArgumentList $mountArgs -WindowStyle Hidden
Write-Host "S3 mount started"

# Wait for mount (up to 30 seconds)
$retries = 0
while (!(Test-Path S:\\) -and $retries -lt 30) {
    Start-Sleep -Seconds 1
    $retries++
}

if (Test-Path S:\\) {
    Write-Host "S: drive mounted successfully"
} else {
    Write-Host "Warning: S: drive mount timeout"
}
'@ | Out-File -FilePath C:\\Scripts\\mount-s3.ps1 -Encoding UTF8

# ==============================================================================
# 11. Install VNC Server
# ==============================================================================
Write-Host 'Installing TightVNC...'
Invoke-WebRequest -Uri 'https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi' -OutFile 'C:\\Temp\\vnc.msi' -UseBasicParsing
Start-Process msiexec.exe -ArgumentList '/i', 'C:\\Temp\\vnc.msi', '/quiet', '/norestart', 'ADDLOCAL=Server', 'SET_USEVNCAUTHENTICATION=1', 'VALUE_OF_USEVNCAUTHENTICATION=1', 'SET_PASSWORD=1', "VALUE_OF_PASSWORD=$vncPassword" -Wait
Remove-Item 'C:\\Temp\\vnc.msi' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Allow VNC 5900' -Direction Inbound -LocalPort 5900 -Protocol TCP -Action Allow -Enabled True -ErrorAction SilentlyContinue

# ==============================================================================
# 12. Create vmuser account
# ==============================================================================
Write-Host 'Creating vmuser account...'
if (-not (Get-LocalUser -Name 'vmuser' -ErrorAction SilentlyContinue)) {
  New-LocalUser -Name 'vmuser' -Password (ConvertTo-SecureString $vmPassword -AsPlainText -Force) -Description 'MCP User' -PasswordNeverExpires
  Add-LocalGroupMember -Group 'Administrators' -Member 'vmuser'
}

# ==============================================================================
# 13. Configure Auto-login
# ==============================================================================
Write-Host 'Configuring auto-login...'
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v AutoAdminLogon /t REG_SZ /d 1 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultUsername /t REG_SZ /d vmuser /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultPassword /t REG_SZ /d $vmPassword /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultDomainName /t REG_SZ /d . /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v ForceAutoLogon /t REG_SZ /d 1 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' /v DisableCAD /t REG_DWORD /d 1 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' /v dontdisplaylastusername /t REG_DWORD /d 0 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' /v DisableAutomaticRestartSignOn /t REG_DWORD /d 0 /f

# ==============================================================================
# 14. Create MCP Startup Script (with OTEL, Sentry, S3 mount, screen recording)
# ==============================================================================
Write-Host 'Creating MCP startup script...'
@'
Start-Transcript -Path C:\\MCP\\logs\\mcp-startup-$((Get-Date).ToString('yyyyMMdd-HHmmss')).log
Write-Host 'Starting MCP with OTEL telemetry (ProcessStartInfo method)...'
Get-Process terminator* -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Mount S3 Drive (must happen in user session)
Write-Host 'Mounting S3 drive...'
& C:\\Scripts\\mount-s3.ps1
Start-Sleep -Seconds 5

# Start Screen Recording (Segmented 10-min chunks)
Write-Host 'Starting continuous screen recording...'
# Wait for S: drive (up to 30s)
$retries = 0
while (!(Test-Path S:\\) -and $retries -lt 30) { Start-Sleep -Seconds 1; $retries++ }

if (Test-Path S:\\) {
    $recDir = "S:\\recordings\\$env:COMPUTERNAME\\$((Get-Date).ToString('yyyy-MM-dd'))"
    if (!(Test-Path $recDir)) { New-Item -ItemType Directory -Force -Path $recDir | Out-Null }

    # Use fragmented MP4 so files are playable while still recording
    $ffmpegArgs = "-f gdigrab -framerate 5 -i desktop -c:v libx264 -preset ultrafast -crf 35 -pix_fmt yuv420p -g 25 -f segment -segment_time 600 -segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof -reset_timestamps 1 -strftime 1 \`"$recDir\\%H-%M-%S.mp4\`""
    Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgs -WindowStyle Hidden
    Write-Host "Recording started to $recDir"
} else {
    Write-Host "S: drive not found, skipping recording"
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'C:\\MCP\\terminator-mcp-agent.exe'
$psi.Arguments = '-t http --host 0.0.0.0 -p 8080 --auth-token ***REMOVED***'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

# Copy all environment variables
foreach ($key in [System.Environment]::GetEnvironmentVariables().Keys) {
    $psi.EnvironmentVariables[$key] = [System.Environment]::GetEnvironmentVariable($key)
}

# Fix user environment paths
$psi.EnvironmentVariables['USERPROFILE'] = 'C:\\Users\\vmuser'
$psi.EnvironmentVariables['LOCALAPPDATA'] = 'C:\\Users\\vmuser\\AppData\\Local'
$psi.EnvironmentVariables['APPDATA'] = 'C:\\Users\\vmuser\\AppData\\Roaming'
$psi.EnvironmentVariables['TEMP'] = 'C:\\Users\\vmuser\\AppData\\Local\\Temp'
$psi.EnvironmentVariables['TMP'] = 'C:\\Users\\vmuser\\AppData\\Local\\Temp'
$psi.EnvironmentVariables['HOMEPATH'] = '\\Users\\vmuser'
$psi.EnvironmentVariables['HOMEDRIVE'] = 'C:'

# Get host information for telemetry
$hostname = [System.Net.Dns]::GetHostName()
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'} | Select-Object -First 1).IPAddress

# Configure MCP authentication
$psi.EnvironmentVariables['MCP_AUTH_TOKEN'] = '***REMOVED***'

# Configure OTEL telemetry
$psi.EnvironmentVariables['OTEL_SDK_ENABLED'] = [System.Environment]::GetEnvironmentVariable('OTEL_SDK_ENABLED', 'Machine')
$psi.EnvironmentVariables['OTEL_EXPORTER_OTLP_ENDPOINT'] = $env:OTEL_COLLECTOR_ENDPOINT
$psi.EnvironmentVariables['OTEL_SERVICE_NAME'] = 'mcp-vm-agent'
$psi.EnvironmentVariables['OTEL_RESOURCE_ATTRIBUTES'] = "host.name=$hostname,host.ip=$ip"
$psi.EnvironmentVariables['OTEL_SKIP_COLLECTOR_CHECK'] = 'true'
$psi.EnvironmentVariables['RUST_LOG'] = 'terminator_mcp_agent=debug,terminator=debug,hyper=warn,reqwest=warn,h2=warn'

# Configure Sentry error tracking
$psi.EnvironmentVariables['SENTRY_DSN'] = $env:SENTRY_DSN
$psi.EnvironmentVariables['SENTRY_ENVIRONMENT'] = if ($env:SENTRY_ENVIRONMENT) { $env:SENTRY_ENVIRONMENT } else { 'production' }
$psi.EnvironmentVariables['SENTRY_DEPLOYMENT_TYPE'] = if ($env:SENTRY_DEPLOYMENT_TYPE) { $env:SENTRY_DEPLOYMENT_TYPE } else { 'backend-vm' }
$vmName = if ($env:AZURE_VM_NAME) { $env:AZURE_VM_NAME } else { 'unknown' }
$rgName = if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { 'unknown' }
$vmPurpose = if ($env:AZURE_VM_PURPOSE) { $env:AZURE_VM_PURPOSE } else { 'unknown' }
$psi.EnvironmentVariables['SENTRY_SERVER_NAME'] = "$hostname ($ip) - VM: $vmName - RG: $rgName"
$psi.EnvironmentVariables['SENTRY_TAGS'] = "deployment_type:backend-vm,vm_name:$vmName,resource_group:$rgName,purpose:$vmPurpose"

Write-Host "DEBUG: OTEL endpoint configured: $env:OTEL_COLLECTOR_ENDPOINT"
Write-Host "DEBUG: MCP authentication enabled with Bearer token"
Write-Host "DEBUG: Sentry error tracking enabled (deployment_type: backend-vm)"

$proc = [System.Diagnostics.Process]::Start($psi)

# Setup async log streaming
Start-Job -ScriptBlock {
    param($processId)
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
        $proc.StandardOutput.BaseStream.CopyToAsync([System.IO.File]::OpenWrite('C:\\MCP\\logs\\mcp-output.log'))
        $proc.StandardError.BaseStream.CopyToAsync([System.IO.File]::OpenWrite('C:\\MCP\\logs\\mcp-output.log'))
    }
} -ArgumentList $proc.Id | Out-Null

Write-Host "MCP started with PID: $($proc.Id)"
Write-Host "OTEL endpoint: $env:OTEL_COLLECTOR_ENDPOINT"
Write-Host "Service name: mcp-vm-agent"
Write-Host "Resource attributes: host.name=$hostname,host.ip=$ip"
Write-Host "Output logged to: C:\\MCP\\logs\\mcp-output.log"
Stop-Transcript
'@ | Out-File -FilePath C:\\MCP\\start-mcp-user-session.ps1 -Encoding UTF8

# ==============================================================================
# 15. Create Scheduled Tasks (MCP startup + auto-login enforcement)
# ==============================================================================
Write-Host 'Creating scheduled tasks...'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -File C:\\MCP\\start-mcp-user-session.ps1'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User 'vmuser'
$principal = New-ScheduledTaskPrincipal -UserId 'vmuser' -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'StartMCPUserSession' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force

# Create auto-login enforcement script (self-healing on every boot)
Write-Host 'Creating auto-login enforcement script...'
@'
# Enforce auto-login settings on every boot (runs as SYSTEM before logon)
$winlogonPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
Set-ItemProperty -Path $winlogonPath -Name 'AutoAdminLogon' -Value '1' -Type String
Set-ItemProperty -Path $winlogonPath -Name 'DefaultUsername' -Value 'vmuser' -Type String
Set-ItemProperty -Path $winlogonPath -Name 'DefaultPassword' -Value '${options.vmPassword}' -Type String
Set-ItemProperty -Path $winlogonPath -Name 'DefaultDomainName' -Value '.' -Type String
Set-ItemProperty -Path $winlogonPath -Name 'ForceAutoLogon' -Value '1' -Type String
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name 'DisableCAD' -Value 1 -Type DWord
'@ | Out-File -FilePath C:\\MCP\\enforce-autologin.ps1 -Encoding UTF8

# Create scheduled task to run at system startup (BEFORE any user logon)
$autoLoginAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\MCP\\enforce-autologin.ps1'
$autoLoginTrigger = New-ScheduledTaskTrigger -AtStartup
$autoLoginPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$autoLoginSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'EnforceAutoLogin' -Action $autoLoginAction -Trigger $autoLoginTrigger -Principal $autoLoginPrincipal -Settings $autoLoginSettings -Force
Write-Host 'Auto-login enforcement scheduled task created'

# ==============================================================================
# 16. Configure Firewall
# ==============================================================================
Write-Host 'Configuring firewall...'
New-NetFirewallRule -DisplayName 'Allow MCP 8080' -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow -Enabled True -ErrorAction SilentlyContinue

# ==============================================================================
# 17. Disable Server Manager and diagnostic screens
# ==============================================================================
Write-Host 'Disabling Server Manager...'
$serverManagerPath = 'HKLM:\\SOFTWARE\\Microsoft\\ServerManager'
if (-not (Test-Path $serverManagerPath)) { New-Item -Path $serverManagerPath -Force | Out-Null }
Set-ItemProperty -Path $serverManagerPath -Name 'DoNotOpenServerManagerAtLogon' -Value 1 -Type DWord

$oobePath = 'HKLM:\\SOFTWARE\\Microsoft\\ServerManager\\Oobe'
if (-not (Test-Path $oobePath)) { New-Item -Path $oobePath -Force | Out-Null }
Set-ItemProperty -Path $oobePath -Name 'DoNotOpenInitialConfigurationTasksAtLogon' -Value 1 -Type DWord

$privacyPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\OOBE'
if (-not (Test-Path $privacyPath)) { New-Item -Path $privacyPath -Force | Out-Null }
New-ItemProperty -Path $privacyPath -Name 'DisablePrivacyExperience' -Value 1 -PropertyType DWord -Force | Out-Null

$dcPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection'
if (-not (Test-Path $dcPath)) { New-Item -Path $dcPath -Force | Out-Null }
New-ItemProperty -Path $dcPath -Name 'AllowTelemetry' -Value 1 -PropertyType DWord -Force | Out-Null

$feedbackPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Feedback'
if (-not (Test-Path $feedbackPath)) { New-Item -Path $feedbackPath -Force | Out-Null }
New-ItemProperty -Path $feedbackPath -Name 'DoNotShowFeedbackNotifications' -Value 1 -PropertyType DWord -Force | Out-Null

# ==============================================================================
# 18. Cleanup
# ==============================================================================
Write-Host 'Cleaning up...'
Remove-Item -Path 'C:\\Windows\\Temp\\*' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'C:\\Users\\*\\AppData\\Local\\Temp\\*' -Recurse -Force -ErrorAction SilentlyContinue
wevtutil cl System
wevtutil cl Application
wevtutil cl Security

# ==============================================================================
# 19. Prepare for specialized image (NO SYSPREP)
# ==============================================================================
# We do NOT run sysprep - this creates a SPECIALIZED image
# The image will boot directly into vmuser with all settings preserved
# This avoids OOBE (first-run experience) and keeps credentials intact

Write-Host 'Preparing for specialized image capture...'
# Ensure auto-login is definitely set before capture
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v AutoAdminLogon /t REG_SZ /d 1 /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultUsername /t REG_SZ /d vmuser /f
reg add 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' /v DefaultPassword /t REG_SZ /d $vmPassword /f

Write-Host 'Provisioning complete! Image will be captured as SPECIALIZED (no sysprep).'
`;
}
async function createImageTemplate(templateName, options, onProgress) {
  const subscriptionId = getSubscriptionId();
  const client = getImageBuilderClient();
  const identityId = IMAGE_BUILDER_IDENTITY.replace("{subscriptionId}", subscriptionId);
  const progress = (step, status, message) => {
    console.log(`[Image Builder] ${step}: ${message}`);
    onProgress?.({ step, status, message });
  };
  try {
    progress("template", "in_progress", `Creating image template: ${templateName}`);
    const versionName = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const formattedVersion = `${versionName.slice(0, 4)}.${versionName.slice(4, 8)}.${versionName.slice(8, 12)}`;
    const template = {
      location: IMAGE_CONFIG.location,
      identity: {
        type: "UserAssigned",
        userAssignedIdentities: {
          [identityId]: {}
        }
      },
      source: {
        type: "PlatformImage",
        publisher: IMAGE_CONFIG.baseImagePublisher,
        offer: IMAGE_CONFIG.baseImageOffer,
        sku: IMAGE_CONFIG.baseImageSku,
        version: "latest"
      },
      customize: [
        {
          type: "PowerShell",
          name: "ProvisionMCP",
          inline: [generateProvisioningScript(options)],
          runElevated: true,
          runAsSystem: true
        }
      ],
      distribute: [
        {
          type: "SharedImage",
          galleryImageId: `/subscriptions/${subscriptionId}/resourceGroups/${IMAGE_CONFIG.resourceGroup}/providers/Microsoft.Compute/galleries/${IMAGE_CONFIG.galleryName}/images/${IMAGE_CONFIG.galleryImageName}`,
          runOutputName: `${templateName}-output`,
          artifactTags: {
            "created-by": "mediar-image-builder",
            "created-at": (/* @__PURE__ */ new Date()).toISOString(),
            "os-state": "specialized"
          },
          replicationRegions: [IMAGE_CONFIG.location],
          versioning: {
            scheme: "Latest"
          },
          excludeFromLatest: false
        }
      ],
      vmProfile: {
        vmSize: IMAGE_CONFIG.vmSize,
        osDiskSizeGB: 128
      },
      buildTimeoutInMinutes: 120
    };
    const poller = await client.virtualMachineImageTemplates.beginCreateOrUpdate(
      IMAGE_CONFIG.resourceGroup,
      templateName,
      template
    );
    await poller.pollUntilDone();
    progress("template", "completed", "Image template created");
    return {
      success: true,
      templateName,
      versionName: formattedVersion
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Image Builder] Template creation failed:", error);
    return { success: false, error: errorMessage };
  }
}
async function runImageBuild(templateName, onProgress) {
  const client = getImageBuilderClient();
  const progress = (step, status, message, runState) => {
    console.log(`[Image Builder] ${step}: ${message}`);
    onProgress?.({ step, status, message, runState });
  };
  try {
    progress("build", "in_progress", "Starting image build...");
    const poller = await client.virtualMachineImageTemplates.beginRun(
      IMAGE_CONFIG.resourceGroup,
      templateName
    );
    progress("build", "in_progress", "Build started, waiting for completion (this may take 30-60 minutes)...");
    while (!poller.isDone()) {
      await new Promise((resolve) => setTimeout(resolve, 3e4));
      try {
        const template = await client.virtualMachineImageTemplates.get(
          IMAGE_CONFIG.resourceGroup,
          templateName
        );
        const runState = template.lastRunStatus?.runState || "Unknown";
        const runSubState = template.lastRunStatus?.runSubState || "";
        progress("build", "in_progress", `Build state: ${runState} - ${runSubState}`, runState);
        if (runState === "Failed") {
          const errorMessage = template.lastRunStatus?.message || "Build failed";
          return { success: false, error: errorMessage, templateName };
        }
      } catch {
      }
    }
    await poller.pollUntilDone();
    const finalTemplate = await client.virtualMachineImageTemplates.get(
      IMAGE_CONFIG.resourceGroup,
      templateName
    );
    if (finalTemplate.lastRunStatus?.runState === "Succeeded") {
      progress("build", "completed", "Image build completed successfully");
      return {
        success: true,
        templateName,
        runOutputId: `${templateName}-output`
      };
    } else {
      const errorMessage = finalTemplate.lastRunStatus?.message || "Build failed";
      return { success: false, error: errorMessage, templateName };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Image Builder] Build failed:", error);
    return { success: false, error: errorMessage, templateName };
  }
}
async function buildImage(options, onProgress) {
  const templateName = `mcp-full-${Date.now()}`;
  const templateResult = await createImageTemplate(templateName, options, onProgress);
  if (!templateResult.success) {
    return templateResult;
  }
  return runImageBuild(templateName, onProgress);
}
async function deleteImageTemplate(templateName) {
  const client = getImageBuilderClient();
  try {
    const poller = await client.virtualMachineImageTemplates.beginDelete(
      IMAGE_CONFIG.resourceGroup,
      templateName
    );
    await poller.pollUntilDone();
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
async function listImageTemplates() {
  const client = getImageBuilderClient();
  try {
    const templates = [];
    for await (const template of client.virtualMachineImageTemplates.listByResourceGroup(IMAGE_CONFIG.resourceGroup)) {
      templates.push({
        name: template.name || "unknown",
        location: template.location || IMAGE_CONFIG.location,
        lastRunState: template.lastRunStatus?.runState,
        lastRunTime: template.lastRunStatus?.endTime
      });
    }
    return { success: true, templates };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
async function getLatestGalleryImageVersion() {
  const subscriptionId = getSubscriptionId();
  const credential2 = getAzureCredential();
  const computeClient2 = new ComputeManagementClient2(credential2, subscriptionId);
  try {
    const versions = [];
    const paginator = computeClient2.galleryImageVersions.listByGalleryImage(IMAGE_CONFIG.resourceGroup, IMAGE_CONFIG.galleryName, IMAGE_CONFIG.galleryImageName).byPage();
    for await (const page of paginator) {
      versions.push(...page);
    }
    if (versions.length === 0) {
      return { success: false, error: "No gallery image versions found" };
    }
    const sortedVersions = versions.filter((v) => !!v.name).sort((a, b) => b.name.localeCompare(a.name));
    const latestVersion = sortedVersions[0].name;
    const imageId = `/subscriptions/${subscriptionId}/resourceGroups/${IMAGE_CONFIG.resourceGroup}/providers/Microsoft.Compute/galleries/${IMAGE_CONFIG.galleryName}/images/${IMAGE_CONFIG.galleryImageName}/versions/${latestVersion}`;
    return {
      success: true,
      version: latestVersion,
      imageId
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
async function checkImageBuilderPrerequisites() {
  const subscriptionId = getSubscriptionId();
  const missing = [];
  const instructions = [];
  instructions.push(
    "1. Create user-assigned managed identity:",
    `   az identity create -g UI-AUTOMATION-IMAGES-RG -n image-builder-identity`,
    "",
    "2. Assign Contributor role to the identity:",
    `   IDENTITY_ID=$(az identity show -g UI-AUTOMATION-IMAGES-RG -n image-builder-identity --query principalId -o tsv)`,
    `   az role assignment create --assignee $IDENTITY_ID --role Contributor --scope /subscriptions/${subscriptionId}/resourceGroups/UI-AUTOMATION-IMAGES-RG`,
    "",
    "3. Register the Image Builder provider:",
    `   az provider register -n Microsoft.VirtualMachineImages`,
    "",
    "4. Ensure the Compute Gallery exists with specialized image definition:",
    `   The gallery 'mcpimages' and image 'mcp-full' should already exist from Terraform`
  );
  return {
    ready: true,
    // Assume ready, will fail at runtime if not
    missing,
    instructions
  };
}
export {
  AzureResourceParseError,
  InfraAttributes,
  POWER_STATE_MAP,
  SpanStatusCode,
  VNC_GATEWAY_URL,
  addSpanEvent,
  buildAzureResourceId,
  buildAzureVmResourceId,
  buildImage,
  checkImageBuilderPrerequisites,
  createAuditContext,
  createImageTemplate,
  deallocateVm,
  deleteImageTemplate,
  extractHostFromEndpoint,
  getAzureCredential,
  getComputeClient,
  getComputeClientForSubscription,
  getLatestGalleryImageVersion,
  getNetworkClient,
  getSubscriptionId,
  getVmPublicIp,
  getVmState,
  initTelemetry,
  isAzureConfigured,
  isValidAzureResourceId,
  isValidAzureVmResourceId,
  isVmReady,
  listImageTemplates,
  parseAzureResourceId,
  parseAzureVmResourceId,
  recordFailure,
  recordSuccess,
  resetClients,
  restartVm,
  runCommand,
  runImageBuild,
  shutdownTelemetry,
  startInfraSpan,
  startVm,
  stopVm,
  withSpan
};
//# sourceMappingURL=index.mjs.map