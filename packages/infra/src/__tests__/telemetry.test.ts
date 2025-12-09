import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  InfraAttributes,
  createAuditContext,
  startInfraSpan,
  recordSuccess,
  recordFailure,
} from '../telemetry/index.js';

describe('InfraAttributes', () => {
  test('has expected attribute keys', () => {
    expect(InfraAttributes.OPERATION_TYPE).toBe('infra.operation.type');
    expect(InfraAttributes.ACTOR_ID).toBe('infra.actor.id');
    expect(InfraAttributes.ACTOR_TYPE).toBe('infra.actor.type');
    expect(InfraAttributes.RESOURCE_TYPE).toBe('infra.resource.type');
    expect(InfraAttributes.AZURE_SUBSCRIPTION_ID).toBe('azure.subscription.id');
    expect(InfraAttributes.VM_POWER_STATE).toBe('azure.vm.power_state');
  });
});

describe('createAuditContext', () => {
  test('creates context with actor and type', () => {
    const ctx = createAuditContext('user-123', 'api');
    expect(ctx.actor).toBe('user-123');
    expect(ctx.actorType).toBe('api');
  });

  test('creates context for CLI', () => {
    const ctx = createAuditContext('cli', 'cli');
    expect(ctx.actor).toBe('cli');
    expect(ctx.actorType).toBe('cli');
  });

  test('creates context for system', () => {
    const ctx = createAuditContext('scheduler', 'system');
    expect(ctx.actor).toBe('scheduler');
    expect(ctx.actorType).toBe('system');
  });
});

describe('startInfraSpan', () => {
  test('creates span with correct attributes', () => {
    const span = startInfraSpan('test.operation', {
      operation: 'vm.start',
      actor: 'user-123',
      actorType: 'api',
      resourceType: 'vm',
      resourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm',
      resourceName: 'vm',
    });

    expect(span).toBeDefined();
    // Span is created, we can't easily inspect internal attributes
    // but we verify it doesn't throw
    span.end();
  });
});

describe('recordSuccess', () => {
  test('ends span with success status', () => {
    const span = startInfraSpan('test.success', {
      operation: 'vm.start',
      actor: 'test',
      actorType: 'system',
      resourceType: 'vm',
    });

    // Should not throw
    recordSuccess(span, { custom_attr: 'value' });
  });
});

describe('recordFailure', () => {
  test('ends span with failure status from Error', () => {
    const span = startInfraSpan('test.failure', {
      operation: 'vm.start',
      actor: 'test',
      actorType: 'system',
      resourceType: 'vm',
    });

    const error = new Error('Test error');
    // Should not throw
    recordFailure(span, error, 'TestError');
  });

  test('ends span with failure status from string', () => {
    const span = startInfraSpan('test.failure.string', {
      operation: 'vm.start',
      actor: 'test',
      actorType: 'system',
      resourceType: 'vm',
    });

    // Should not throw
    recordFailure(span, 'Something went wrong');
  });
});
