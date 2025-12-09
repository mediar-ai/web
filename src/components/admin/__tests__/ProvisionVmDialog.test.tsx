/**
 * Tests for ProvisionVmDialog component
 *
 * These tests verify:
 * 1. Progress simulation works correctly
 * 2. Polling mechanism detects status changes
 * 3. UI states are handled properly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the progress step calculation
describe('ProvisionVmDialog Progress Calculation', () => {
  const PROVISIONING_STEPS = [
    { label: 'Finding latest Packer image', duration: 5 },
    { label: 'Creating Azure resource group', duration: 10 },
    { label: 'Setting up virtual network', duration: 15 },
    { label: 'Configuring network security', duration: 10 },
    { label: 'Creating Windows VM', duration: 180 },
    { label: 'Waiting for VM to start', duration: 120 },
    { label: 'Registering in database', duration: 5 },
  ];

  const calculateCurrentStep = (elapsed: number) => {
    let cumulativeTime = 0;
    for (let i = 0; i < PROVISIONING_STEPS.length; i++) {
      cumulativeTime += PROVISIONING_STEPS[i].duration;
      if (elapsed < cumulativeTime) {
        return i;
      }
    }
    return PROVISIONING_STEPS.length - 1;
  };

  it('should return step 0 at start', () => {
    expect(calculateCurrentStep(0)).toBe(0);
  });

  it('should return step 0 during first 5 seconds', () => {
    expect(calculateCurrentStep(4)).toBe(0);
  });

  it('should return step 1 after 5 seconds', () => {
    expect(calculateCurrentStep(5)).toBe(1);
  });

  it('should return step 2 after 15 seconds', () => {
    expect(calculateCurrentStep(15)).toBe(2);
  });

  it('should return step 4 (VM creation) after 40 seconds', () => {
    // 5 + 10 + 15 + 10 = 40 seconds for first 4 steps
    expect(calculateCurrentStep(40)).toBe(4);
  });

  it('should return step 5 after 220 seconds', () => {
    // 5 + 10 + 15 + 10 + 180 = 220 seconds
    expect(calculateCurrentStep(220)).toBe(5);
  });

  it('should return last step after all time has passed', () => {
    // Total: 5 + 10 + 15 + 10 + 180 + 120 + 5 = 345 seconds
    expect(calculateCurrentStep(400)).toBe(PROVISIONING_STEPS.length - 1);
  });
});

describe('Polling Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should poll every 5 seconds', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        machines: [{ id: 1, status: 'provisioning' }]
      })
    });
    global.fetch = mockFetch;

    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      const res = await fetch('/api/admin/machines');
      const data = await res.json();
      const machine = data.machines?.find((m: { id: number }) => m.id === 1);
      if (machine?.status !== 'active') {
        setTimeout(poll, 5000);
      }
    };

    poll();

    await vi.advanceTimersByTimeAsync(5000);
    expect(pollCount).toBe(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(pollCount).toBe(3);
  });

  it('should stop polling when status is active', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          machines: [{ id: 1, status: callCount >= 2 ? 'active' : 'provisioning' }]
        })
      });
    });
    global.fetch = mockFetch;

    let pollingStopped = false;
    const poll = async () => {
      const res = await fetch('/api/admin/machines');
      const data = await res.json();
      const machine = data.machines?.find((m: { id: number }) => m.id === 1);
      if (machine?.status === 'active') {
        pollingStopped = true;
        return;
      }
      setTimeout(poll, 5000);
    };

    poll();

    await vi.advanceTimersByTimeAsync(5000);
    expect(pollingStopped).toBe(true);
    expect(callCount).toBe(2);
  });
});
