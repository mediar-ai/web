import { describe, test, expect } from 'bun:test';
import {
  parseAzureResourceId,
  parseAzureVmResourceId,
  buildAzureResourceId,
  buildAzureVmResourceId,
  isValidAzureResourceId,
  isValidAzureVmResourceId,
  AzureResourceParseError,
} from '../azure/resource-parser.js';

describe('parseAzureResourceId', () => {
  test('parses valid resource ID', () => {
    const resourceId = '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm';
    const parsed = parseAzureResourceId(resourceId);

    expect(parsed.subscriptionId).toBe('sub-123');
    expect(parsed.resourceGroup).toBe('my-rg');
    expect(parsed.provider).toBe('Microsoft.Compute');
    expect(parsed.resourceType).toBe('virtualMachines');
    expect(parsed.resourceName).toBe('my-vm');
  });

  test('throws on invalid resource ID', () => {
    expect(() => parseAzureResourceId('invalid')).toThrow(AzureResourceParseError);
  });

  test('throws on empty string', () => {
    expect(() => parseAzureResourceId('')).toThrow(AzureResourceParseError);
  });
});

describe('parseAzureVmResourceId', () => {
  test('parses valid VM resource ID', () => {
    const resourceId = '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm';
    const parsed = parseAzureVmResourceId(resourceId);

    expect(parsed.subscriptionId).toBe('sub-123');
    expect(parsed.resourceGroup).toBe('my-rg');
    expect(parsed.resourceName).toBe('my-vm');
  });

  test('throws on non-VM resource ID', () => {
    const resourceId = '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Network/publicIPAddresses/my-ip';
    expect(() => parseAzureVmResourceId(resourceId)).toThrow(AzureResourceParseError);
  });
});

describe('buildAzureResourceId', () => {
  test('builds valid resource ID', () => {
    const resourceId = buildAzureResourceId({
      subscriptionId: 'sub-123',
      resourceGroup: 'my-rg',
      provider: 'Microsoft.Compute',
      resourceType: 'virtualMachines',
      resourceName: 'my-vm',
    });

    expect(resourceId).toBe('/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm');
  });
});

describe('buildAzureVmResourceId', () => {
  test('builds valid VM resource ID', () => {
    const resourceId = buildAzureVmResourceId('sub-123', 'my-rg', 'my-vm');

    expect(resourceId).toBe('/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm');
  });
});

describe('isValidAzureResourceId', () => {
  test('returns true for valid resource ID', () => {
    const resourceId = '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm';
    expect(isValidAzureResourceId(resourceId)).toBe(true);
  });

  test('returns false for invalid resource ID', () => {
    expect(isValidAzureResourceId('invalid')).toBe(false);
    expect(isValidAzureResourceId('')).toBe(false);
  });
});

describe('isValidAzureVmResourceId', () => {
  test('returns true for valid VM resource ID', () => {
    const resourceId = '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm';
    expect(isValidAzureVmResourceId(resourceId)).toBe(true);
  });

  test('returns false for non-VM resource ID', () => {
    const resourceId = '/subscriptions/sub-123/resourceGroups/my-rg/providers/Microsoft.Network/publicIPAddresses/my-ip';
    expect(isValidAzureVmResourceId(resourceId)).toBe(false);
  });
});
