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
export {
  InfraAttributes,
  SpanStatusCode,
  addSpanEvent,
  createAuditContext,
  initTelemetry,
  recordFailure,
  recordSuccess,
  shutdownTelemetry,
  startInfraSpan,
  withSpan
};
//# sourceMappingURL=index.mjs.map