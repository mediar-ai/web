import { Span } from '@opentelemetry/api';
export { Span, SpanStatusCode } from '@opentelemetry/api';

/**
 * OpenTelemetry Instrumentation for Infrastructure Operations
 * Sends traces, spans, and logs to ClickHouse via OTEL Collector
 */

declare const InfraAttributes: {
    readonly OPERATION_TYPE: "infra.operation.type";
    readonly OPERATION_STATUS: "infra.operation.status";
    readonly ACTOR_ID: "infra.actor.id";
    readonly ACTOR_TYPE: "infra.actor.type";
    readonly RESOURCE_TYPE: "infra.resource.type";
    readonly RESOURCE_ID: "infra.resource.id";
    readonly RESOURCE_NAME: "infra.resource.name";
    readonly AZURE_SUBSCRIPTION_ID: "azure.subscription.id";
    readonly AZURE_RESOURCE_GROUP: "azure.resource_group";
    readonly AZURE_REGION: "azure.region";
    readonly AZURE_VM_SIZE: "azure.vm.size";
    readonly VM_POWER_STATE: "azure.vm.power_state";
    readonly VM_PROVISIONING_STATE: "azure.vm.provisioning_state";
    readonly VM_PUBLIC_IP: "azure.vm.public_ip";
    readonly IMAGE_NAME: "azure.image.name";
    readonly IMAGE_VERSION: "azure.image.version";
    readonly IMAGE_GALLERY: "azure.image.gallery";
    readonly ERROR_TYPE: "error.type";
    readonly ERROR_MESSAGE: "error.message";
};
type InfraOperation = 'vm.provision' | 'vm.delete' | 'vm.start' | 'vm.stop' | 'vm.restart' | 'vm.deallocate' | 'vm.run_command' | 'image.build' | 'image.template.create' | 'image.template.delete' | 'image.list';
type ActorType = 'user' | 'cli' | 'api' | 'system';
type ResourceType = 'vm' | 'image' | 'image_template';
/**
 * Initialize OpenTelemetry SDK
 * Call this once at application startup
 */
declare function initTelemetry(options?: {
    serviceName?: string;
    serviceVersion?: string;
    otlpEndpoint?: string;
}): void;
/**
 * Shutdown telemetry (call on process exit)
 */
declare function shutdownTelemetry(): Promise<void>;
/**
 * Span attributes for infrastructure operations
 */
interface InfraSpanAttributes {
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
declare function startInfraSpan(name: string, attributes: InfraSpanAttributes): Span;
/**
 * Record success on a span
 */
declare function recordSuccess(span: Span, attributes?: Record<string, string | number | boolean>): void;
/**
 * Record failure on a span
 */
declare function recordFailure(span: Span, error: Error | string, errorType?: string): void;
/**
 * Add an event to a span (for logging intermediate steps)
 */
declare function addSpanEvent(span: Span, name: string, attributes?: Record<string, string | number | boolean>): void;
/**
 * Wrap an async function with a traced span
 */
declare function withSpan<T>(name: string, attributes: InfraSpanAttributes, fn: (span: Span) => Promise<T>): Promise<T>;
/**
 * Context for audit logging - carries through the span
 */
interface AuditContext {
    actor: string;
    actorType: ActorType;
    parentSpan?: Span;
}
/**
 * Create audit context for operations
 */
declare function createAuditContext(actor: string, actorType: ActorType): AuditContext;

export { type ActorType, type AuditContext, InfraAttributes, type InfraOperation, type InfraSpanAttributes, type ResourceType, addSpanEvent, createAuditContext, initTelemetry, recordFailure, recordSuccess, shutdownTelemetry, startInfraSpan, withSpan };
