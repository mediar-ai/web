export { AzureResourceId, AzureResourceParseError, AzureVmResourceId, MachineWithAzure, POWER_STATE_MAP, RunCommandOptions, RunCommandResult, VNC_GATEWAY_URL, VmOperation, VmOperationResult, VmOperationStatus, VmOperationType, VmPowerState, VmProvisioningState, VmState, buildAzureResourceId, buildAzureVmResourceId, deallocateVm, extractHostFromEndpoint, getAzureCredential, getComputeClient, getComputeClientForSubscription, getNetworkClient, getSubscriptionId, getVmPublicIp, getVmState, isAzureConfigured, isValidAzureResourceId, isValidAzureVmResourceId, isVmReady, parseAzureResourceId, parseAzureVmResourceId, resetClients, restartVm, runCommand, startVm, stopVm } from './azure/index.js';
export { ActorType, AuditContext, InfraAttributes, InfraOperation, InfraSpanAttributes, ResourceType, addSpanEvent, createAuditContext, initTelemetry, recordFailure, recordSuccess, shutdownTelemetry, startInfraSpan, withSpan } from './telemetry/index.js';
export { Span, SpanStatusCode } from '@opentelemetry/api';
import '@azure/arm-compute';
import '@azure/arm-network';
import '@azure/identity';
