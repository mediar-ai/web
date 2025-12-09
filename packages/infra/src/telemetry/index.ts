/**
 * OpenTelemetry Instrumentation for Infrastructure Operations
 * Sends traces, spans, and logs to ClickHouse via OTEL Collector
 */

import { trace, context, SpanKind, SpanStatusCode, Span, Tracer } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Custom semantic attributes for infra operations
export const InfraAttributes = {
  // Operation attributes
  OPERATION_TYPE: 'infra.operation.type',
  OPERATION_STATUS: 'infra.operation.status',

  // Actor attributes
  ACTOR_ID: 'infra.actor.id',
  ACTOR_TYPE: 'infra.actor.type', // 'user' | 'cli' | 'api' | 'system'

  // Resource attributes
  RESOURCE_TYPE: 'infra.resource.type', // 'vm' | 'image' | 'image_template'
  RESOURCE_ID: 'infra.resource.id',
  RESOURCE_NAME: 'infra.resource.name',

  // Azure-specific attributes
  AZURE_SUBSCRIPTION_ID: 'azure.subscription.id',
  AZURE_RESOURCE_GROUP: 'azure.resource_group',
  AZURE_REGION: 'azure.region',
  AZURE_VM_SIZE: 'azure.vm.size',

  // VM operation attributes
  VM_POWER_STATE: 'azure.vm.power_state',
  VM_PROVISIONING_STATE: 'azure.vm.provisioning_state',
  VM_PUBLIC_IP: 'azure.vm.public_ip',

  // Image operation attributes
  IMAGE_NAME: 'azure.image.name',
  IMAGE_VERSION: 'azure.image.version',
  IMAGE_GALLERY: 'azure.image.gallery',

  // Error attributes
  ERROR_TYPE: 'error.type',
  ERROR_MESSAGE: 'error.message',
} as const;

// Operation types
export type InfraOperation =
  | 'vm.provision'
  | 'vm.delete'
  | 'vm.start'
  | 'vm.stop'
  | 'vm.restart'
  | 'vm.deallocate'
  | 'vm.run_command'
  | 'image.build'
  | 'image.template.create'
  | 'image.template.delete'
  | 'image.list';

export type ActorType = 'user' | 'cli' | 'api' | 'system';
export type ResourceType = 'vm' | 'image' | 'image_template';

let sdk: NodeSDK | null = null;
let tracer: Tracer | null = null;

/**
 * Initialize OpenTelemetry SDK
 * Call this once at application startup
 */
export function initTelemetry(options?: {
  serviceName?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
}): void {
  const otlpEndpoint = options?.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

  const exporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options?.serviceName || 'mediar-infra',
      [ATTR_SERVICE_VERSION]: options?.serviceVersion || '0.1.0',
      'deployment.environment': process.env.NODE_ENV || 'development',
    }),
    spanProcessor: new BatchSpanProcessor(exporter),
  });

  sdk.start();
  tracer = trace.getTracer('mediar-infra');

  console.log(`[Telemetry] Initialized, exporting to ${otlpEndpoint}`);
}

/**
 * Shutdown telemetry (call on process exit)
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    console.log('[Telemetry] Shutdown complete');
  }
}

/**
 * Get or create the tracer
 */
function getTracer(): Tracer {
  if (!tracer) {
    // Auto-init with defaults if not explicitly initialized
    initTelemetry();
    tracer = trace.getTracer('mediar-infra');
  }
  return tracer;
}

/**
 * Span attributes for infrastructure operations
 */
export interface InfraSpanAttributes {
  operation: InfraOperation;
  actor: string;
  actorType: ActorType;
  resourceType: ResourceType;
  resourceId?: string;
  resourceName?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  region?: string;
  vmSize?: string;
  imageName?: string;
  imageVersion?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Start a span for an infrastructure operation
 */
export function startInfraSpan(
  name: string,
  attributes: InfraSpanAttributes
): Span {
  const tracer = getTracer();

  const span = tracer.startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [InfraAttributes.OPERATION_TYPE]: attributes.operation,
      [InfraAttributes.ACTOR_ID]: attributes.actor,
      [InfraAttributes.ACTOR_TYPE]: attributes.actorType,
      [InfraAttributes.RESOURCE_TYPE]: attributes.resourceType,
      ...(attributes.resourceId && { [InfraAttributes.RESOURCE_ID]: attributes.resourceId }),
      ...(attributes.resourceName && { [InfraAttributes.RESOURCE_NAME]: attributes.resourceName }),
      ...(attributes.subscriptionId && { [InfraAttributes.AZURE_SUBSCRIPTION_ID]: attributes.subscriptionId }),
      ...(attributes.resourceGroup && { [InfraAttributes.AZURE_RESOURCE_GROUP]: attributes.resourceGroup }),
      ...(attributes.region && { [InfraAttributes.AZURE_REGION]: attributes.region }),
      ...(attributes.vmSize && { [InfraAttributes.AZURE_VM_SIZE]: attributes.vmSize }),
      ...(attributes.imageName && { [InfraAttributes.IMAGE_NAME]: attributes.imageName }),
      ...(attributes.imageVersion && { [InfraAttributes.IMAGE_VERSION]: attributes.imageVersion }),
    },
  });

  return span;
}

/**
 * Record success on a span
 */
export function recordSuccess(span: Span, attributes?: Record<string, string | number | boolean>): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.setAttribute(InfraAttributes.OPERATION_STATUS, 'success');

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }

  span.end();
}

/**
 * Record failure on a span
 */
export function recordFailure(span: Span, error: Error | string, errorType?: string): void {
  const errorMessage = error instanceof Error ? error.message : error;

  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: errorMessage,
  });

  span.setAttribute(InfraAttributes.OPERATION_STATUS, 'failed');
  span.setAttribute(InfraAttributes.ERROR_MESSAGE, errorMessage);

  if (errorType) {
    span.setAttribute(InfraAttributes.ERROR_TYPE, errorType);
  }

  if (error instanceof Error && error.stack) {
    span.recordException(error);
  }

  span.end();
}

/**
 * Add an event to a span (for logging intermediate steps)
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, string | number | boolean>
): void {
  span.addEvent(name, attributes);
}

/**
 * Wrap an async function with a traced span
 */
export async function withSpan<T>(
  name: string,
  attributes: InfraSpanAttributes,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const span = startInfraSpan(name, attributes);

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));

    recordSuccess(span, {
      ...(typeof result === 'object' && result !== null && 'success' in result
        ? { result_success: (result as { success: boolean }).success }
        : {}),
    });

    return result;
  } catch (error) {
    recordFailure(span, error instanceof Error ? error : String(error));
    throw error;
  }
}

/**
 * Context for audit logging - carries through the span
 */
export interface AuditContext {
  actor: string;
  actorType: ActorType;
  parentSpan?: Span;
}

/**
 * Create audit context for operations
 */
export function createAuditContext(actor: string, actorType: ActorType): AuditContext {
  return { actor, actorType };
}

// Re-export for convenience
export type { Span };
export { SpanStatusCode };
