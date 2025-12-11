#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli/index.ts
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"));
var import_ora = __toESM(require("ora"));
var import_dotenv = require("dotenv");

// src/azure/types.ts
var POWER_STATE_MAP = {
  "PowerState/running": "running",
  "PowerState/deallocated": "deallocated",
  "PowerState/stopped": "stopped",
  "PowerState/starting": "starting",
  "PowerState/stopping": "stopping",
  "PowerState/deallocating": "deallocating"
};

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

// src/azure/client.ts
var import_arm_compute = require("@azure/arm-compute");
var import_arm_network = require("@azure/arm-network");
var import_identity = require("@azure/identity");
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
      credential = new import_identity.ClientSecretCredential(tenantId, clientId, clientSecret);
    } else {
      console.log("[Azure] Using DefaultAzureCredential (local dev mode)");
      credential = new import_identity.DefaultAzureCredential();
    }
  }
  return credential;
}
function getComputeClient() {
  if (!computeClient) {
    const subscriptionId = getSubscriptionId();
    const cred = getAzureCredential();
    computeClient = new import_arm_compute.ComputeManagementClient(cred, subscriptionId);
  }
  return computeClient;
}
function getNetworkClient() {
  if (!networkClient) {
    const subscriptionId = getSubscriptionId();
    const cred = getAzureCredential();
    networkClient = new import_arm_network.NetworkManagementClient(cred, subscriptionId);
  }
  return networkClient;
}
function isAzureConfigured() {
  try {
    getSubscriptionId();
    return true;
  } catch {
    return false;
  }
}

// src/telemetry/index.ts
var import_api = require("@opentelemetry/api");
var import_sdk_node = require("@opentelemetry/sdk-node");
var import_exporter_trace_otlp_http = require("@opentelemetry/exporter-trace-otlp-http");
var import_resources = require("@opentelemetry/resources");
var import_semantic_conventions = require("@opentelemetry/semantic-conventions");
var import_sdk_trace_base = require("@opentelemetry/sdk-trace-base");
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
  const exporter = new import_exporter_trace_otlp_http.OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`
  });
  sdk = new import_sdk_node.NodeSDK({
    resource: (0, import_resources.resourceFromAttributes)({
      [import_semantic_conventions.ATTR_SERVICE_NAME]: options?.serviceName || "mediar-infra",
      [import_semantic_conventions.ATTR_SERVICE_VERSION]: options?.serviceVersion || "0.1.0",
      "deployment.environment": process.env.NODE_ENV || "development"
    }),
    spanProcessor: new import_sdk_trace_base.BatchSpanProcessor(exporter)
  });
  sdk.start();
  tracer = import_api.trace.getTracer("mediar-infra");
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
    tracer = import_api.trace.getTracer("mediar-infra");
  }
  return tracer;
}
function startInfraSpan(name, attributes) {
  const tracer2 = getTracer();
  const span = tracer2.startSpan(name, {
    kind: import_api.SpanKind.INTERNAL,
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
  span.setStatus({ code: import_api.SpanStatusCode.OK });
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
    code: import_api.SpanStatusCode.ERROR,
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
    const result = await import_api.context.with(import_api.trace.setSpan(import_api.context.active(), span), () => fn(span));
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
  const vm2 = await computeClient2.virtualMachines.instanceView(rg, vmName);
  const statuses = vm2.statuses || [];
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
  const vmExtensions = vm2.extensions || [];
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
async function getVmPublicIp(resourceId) {
  const parsed = parseAzureVmResourceId(resourceId);
  const computeClient2 = getComputeClient();
  const networkClient2 = getNetworkClient();
  const vm2 = await computeClient2.virtualMachines.get(
    parsed.resourceGroup,
    parsed.resourceName
  );
  const nicRef = vm2.networkProfile?.networkInterfaces?.[0];
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
var import_arm_imagebuilder = require("@azure/arm-imagebuilder");
var import_arm_compute2 = require("@azure/arm-compute");

// src/cli/index.ts
(0, import_dotenv.config)();
var program = new import_commander.Command();
program.name("mediar-infra").description("Mediar Infrastructure Management CLI").version("0.1.0");
program.hook("preAction", () => {
  initTelemetry({ serviceName: "mediar-infra-cli" });
});
program.hook("postAction", async () => {
  await shutdownTelemetry();
});
var vm = program.command("vm").description("VM operations");
vm.command("start <resourceId>").description("Start a VM").action(async (resourceId) => {
  if (!isAzureConfigured()) {
    console.error(import_chalk.default.red("Error: Azure credentials not configured"));
    process.exit(1);
  }
  const spinner = (0, import_ora.default)("Starting VM...").start();
  try {
    const result = await startVm(resourceId, createAuditContext("cli", "cli"));
    spinner.succeed(import_chalk.default.green(result.message));
    console.log(import_chalk.default.gray(`  Power state: ${result.state?.powerState}`));
  } catch (error) {
    spinner.fail(import_chalk.default.red(`Failed: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
});
vm.command("stop <resourceId>").description("Stop a VM").action(async (resourceId) => {
  if (!isAzureConfigured()) {
    console.error(import_chalk.default.red("Error: Azure credentials not configured"));
    process.exit(1);
  }
  const spinner = (0, import_ora.default)("Stopping VM...").start();
  try {
    const result = await stopVm(resourceId, createAuditContext("cli", "cli"));
    spinner.succeed(import_chalk.default.green(result.message));
  } catch (error) {
    spinner.fail(import_chalk.default.red(`Failed: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
});
vm.command("restart <resourceId>").description("Restart a VM").action(async (resourceId) => {
  if (!isAzureConfigured()) {
    console.error(import_chalk.default.red("Error: Azure credentials not configured"));
    process.exit(1);
  }
  const spinner = (0, import_ora.default)("Restarting VM...").start();
  try {
    const result = await restartVm(resourceId, createAuditContext("cli", "cli"));
    spinner.succeed(import_chalk.default.green(result.message));
  } catch (error) {
    spinner.fail(import_chalk.default.red(`Failed: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
});
vm.command("deallocate <resourceId>").description("Deallocate a VM (release compute resources)").action(async (resourceId) => {
  if (!isAzureConfigured()) {
    console.error(import_chalk.default.red("Error: Azure credentials not configured"));
    process.exit(1);
  }
  const spinner = (0, import_ora.default)("Deallocating VM...").start();
  try {
    const result = await deallocateVm(resourceId, createAuditContext("cli", "cli"));
    spinner.succeed(import_chalk.default.green(result.message));
  } catch (error) {
    spinner.fail(import_chalk.default.red(`Failed: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
});
vm.command("status <resourceId>").description("Get VM status").action(async (resourceId) => {
  if (!isAzureConfigured()) {
    console.error(import_chalk.default.red("Error: Azure credentials not configured"));
    process.exit(1);
  }
  const spinner = (0, import_ora.default)("Getting VM status...").start();
  try {
    const state = await getVmState(resourceId);
    const ip = await getVmPublicIp(resourceId);
    spinner.stop();
    console.log(import_chalk.default.bold("\nVM Status:"));
    console.log(`  Power State: ${state.powerState === "running" ? import_chalk.default.green(state.powerState) : import_chalk.default.yellow(state.powerState)}`);
    console.log(`  Provisioning State: ${state.provisioningState}`);
    console.log(`  Extensions Ready: ${state.extensionsReady ? import_chalk.default.green("Yes") : import_chalk.default.red("No")}`);
    if (state.blockedExtensions.length > 0) {
      console.log(`  Blocked Extensions: ${import_chalk.default.red(state.blockedExtensions.join(", "))}`);
    }
    if (ip) {
      console.log(`  Public IP: ${import_chalk.default.cyan(ip)}`);
    }
  } catch (error) {
    spinner.fail(import_chalk.default.red(`Failed: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
});
program.command("config").description("Show configuration status").action(() => {
  console.log(import_chalk.default.bold("\nConfiguration Status:"));
  console.log(`  Azure Configured: ${isAzureConfigured() ? import_chalk.default.green("Yes") : import_chalk.default.red("No")}`);
  console.log(`  OTEL Endpoint: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || import_chalk.default.gray("(not set)")}`);
  console.log(`  Subscription ID: ${process.env.AZURE_SUBSCRIPTION_ID ? import_chalk.default.green("Set") : import_chalk.default.red("Not set")}`);
  console.log(`  Tenant ID: ${process.env.AZURE_TENANT_ID ? import_chalk.default.green("Set") : import_chalk.default.gray("Not set (using CLI auth)")}`);
});
program.parse();
//# sourceMappingURL=index.js.map