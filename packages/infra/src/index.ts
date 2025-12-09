/**
 * @mediar/infra - Infrastructure Management Package
 *
 * A library and CLI for managing Mediar Azure infrastructure
 * with built-in OpenTelemetry tracing.
 *
 * @example Library usage
 * ```typescript
 * import { startVm, initTelemetry, createAuditContext } from '@mediar/infra';
 *
 * // Initialize telemetry (optional, will auto-init with defaults)
 * initTelemetry({ serviceName: 'my-app' });
 *
 * // Create audit context for operations
 * const ctx = createAuditContext('user-123', 'api');
 *
 * // Start a VM with tracing
 * const result = await startVm('/subscriptions/.../vms/my-vm', ctx);
 * ```
 *
 * @example CLI usage
 * ```bash
 * mediar-infra vm start /subscriptions/.../vms/my-vm
 * mediar-infra vm status /subscriptions/.../vms/my-vm
 * mediar-infra config
 * ```
 */

// Re-export everything from submodules
export * from './azure/index.js';
export * from './telemetry/index.js';
