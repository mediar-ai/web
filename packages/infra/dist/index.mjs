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
import { Resource } from "@opentelemetry/resources";
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
    resource: new Resource({
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
export {
  AzureResourceParseError,
  InfraAttributes,
  POWER_STATE_MAP,
  SpanStatusCode,
  VNC_GATEWAY_URL,
  addSpanEvent,
  buildAzureResourceId,
  buildAzureVmResourceId,
  createAuditContext,
  deallocateVm,
  extractHostFromEndpoint,
  getAzureCredential,
  getComputeClient,
  getComputeClientForSubscription,
  getNetworkClient,
  getSubscriptionId,
  getVmPublicIp,
  getVmState,
  initTelemetry,
  isAzureConfigured,
  isValidAzureResourceId,
  isValidAzureVmResourceId,
  isVmReady,
  parseAzureResourceId,
  parseAzureVmResourceId,
  recordFailure,
  recordSuccess,
  resetClients,
  restartVm,
  runCommand,
  shutdownTelemetry,
  startInfraSpan,
  startVm,
  stopVm,
  withSpan
};
//# sourceMappingURL=index.mjs.map