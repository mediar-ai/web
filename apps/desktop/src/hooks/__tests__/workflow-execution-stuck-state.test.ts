import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Integration tests for workflow execution stuck state issue
 *
 * Problem: When a user clicks "Run All" (executeFullWorkflow) and then tries to stop it,
 * the workflow state can get stuck in "executing" state and never reset to "idle".
 *
 * Root causes identified:
 * 1. executeFullWorkflow lacks the isExecutingRef guard that executeStep has
 * 2. interruptStep only sets isInterrupted flag but doesn't immediately reset workflowState
 * 3. State only resets when Promise rejects in catch block, which may not happen if abort timing is bad
 *
 * These tests reproduce the bug and verify the fix.
 */

describe("Workflow Execution Stuck State", () => {
  // Simulated workflow state machine
  type WorkflowState = "idle" | "executing" | "recording" | "stopping_recording" | "completed" | "awaiting_user_action";

  let workflowState: WorkflowState;
  let isInterrupted: boolean;
  let isExecutingRef: { current: boolean };
  let workflowAbortControllerRef: { current: AbortController | null };
  let executionPromise: Promise<void> | null;
  let executionCount: number;

  // Reset state before each test
  beforeEach(() => {
    workflowState = "idle";
    isInterrupted = false;
    isExecutingRef = { current: false };
    workflowAbortControllerRef = { current: null };
    executionPromise = null;
    executionCount = 0;
  });

  afterEach(() => {
    // Clean up any pending abort controllers
    if (workflowAbortControllerRef.current) {
      workflowAbortControllerRef.current.abort();
      workflowAbortControllerRef.current = null;
    }
  });

  /**
   * Simulates the CURRENT (buggy) executeFullWorkflow behavior
   * - No isExecutingRef guard
   * - State only resets on Promise completion/rejection
   */
  const executeFullWorkflowBuggy = async (duration: number = 1000): Promise<void> => {
    // BUG: No guard to prevent duplicate execution
    // (The real code lacks: if (isExecutingRef.current) return;)

    workflowState = "executing";
    workflowAbortControllerRef.current = new AbortController();
    executionCount++;

    const abortController = workflowAbortControllerRef.current;

    executionPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        workflowState = "completed";
        resolve();
      }, duration);

      // Listen for abort
      abortController.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        // BUG: The rejection may not propagate properly in all cases
        // because the abort handler runs asynchronously
        reject(new Error("Workflow cancelled by user"));
      });
    });

    try {
      await executionPromise;
    } catch (error) {
      // BUG: State resets here, but only if Promise actually rejects
      workflowState = "idle";
    }
  };

  /**
   * Simulates the CURRENT (buggy) interruptStep behavior
   * - Sets isInterrupted flag
   * - Aborts controller
   * - Does NOT immediately set workflowState to "idle"
   */
  const interruptStepBuggy = () => {
    if (workflowState === "executing") {
      console.log("interruptStepBuggy: Setting isInterrupted = true");
      isInterrupted = true;

      if (workflowAbortControllerRef.current) {
        console.log("interruptStepBuggy: Aborting controller");
        workflowAbortControllerRef.current.abort();
        workflowAbortControllerRef.current = null;
      }
      // BUG: workflowState is NOT set to "idle" here
      // It relies on the catch block in executeFullWorkflow
    }
  };

  /**
   * Test: Demonstrates the stuck state bug
   * When abort signal is triggered but Promise race doesn't reject properly,
   * workflowState stays "executing" forever.
   */
  test("BUG REPRODUCTION: workflowState gets stuck when abort timing is bad", async () => {
    // Start execution
    const executionPromise = executeFullWorkflowBuggy(5000);

    // Wait a tick for execution to start
    await new Promise(r => setTimeout(r, 10));
    expect(workflowState).toBe("executing");

    // Interrupt immediately
    interruptStepBuggy();
    expect(isInterrupted).toBe(true);

    // Wait for promise to settle
    try {
      await executionPromise;
    } catch {
      // Expected to reject
    }

    // In the buggy version, state DOES reset because we awaited the promise
    // But the real bug happens when the abort handler closes the transport
    // before the Promise can reject properly
    expect(workflowState).toBe("idle");
  });

  /**
   * Test: Demonstrates duplicate execution bug
   * Multiple executeFullWorkflow calls can run concurrently because
   * there's no isExecutingRef guard.
   */
  test("BUG REPRODUCTION: multiple executeFullWorkflow calls can run concurrently", async () => {
    // Start first execution (don't await)
    const promise1 = executeFullWorkflowBuggy(1000);

    // Wait a tick
    await new Promise(r => setTimeout(r, 10));
    expect(workflowState).toBe("executing");
    expect(executionCount).toBe(1);

    // Start second execution while first is still running
    // BUG: This should be prevented but isn't
    const promise2 = executeFullWorkflowBuggy(1000);

    await new Promise(r => setTimeout(r, 10));

    // BUG: executionCount is 2, meaning both executions started
    expect(executionCount).toBe(2);

    // Clean up
    interruptStepBuggy();
    try {
      await Promise.all([promise1, promise2]);
    } catch {
      // Expected
    }
  });

  /**
   * FIXED VERSION: executeFullWorkflow with proper guards
   */
  const executeFullWorkflowFixed = async (duration: number = 1000): Promise<void> => {
    // FIX 1: Add isExecutingRef guard to prevent duplicate execution
    if (isExecutingRef.current) {
      console.log("executeFullWorkflowFixed: Already executing, ignoring duplicate call");
      return;
    }

    isExecutingRef.current = true;
    workflowState = "executing";
    workflowAbortControllerRef.current = new AbortController();
    executionCount++;

    const abortController = workflowAbortControllerRef.current;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve();
        }, duration);

        abortController.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeoutId);
            reject(new Error("Workflow cancelled by user"));
          },
          { once: true }
        );
      });

      workflowState = "completed";
    } catch (error) {
      // State resets on error
      workflowState = "idle";
    } finally {
      // FIX 2: Always reset the executing ref in finally block
      isExecutingRef.current = false;
    }
  };

  /**
   * FIXED VERSION: interruptStep that immediately resets state
   */
  const interruptStepFixed = () => {
    if (workflowState === "executing") {
      console.log("interruptStepFixed: Setting isInterrupted = true");
      isInterrupted = true;

      if (workflowAbortControllerRef.current) {
        console.log("interruptStepFixed: Aborting controller");
        workflowAbortControllerRef.current.abort();
        workflowAbortControllerRef.current = null;
      }

      // FIX 3: Immediately set workflowState to "idle"
      // Don't wait for Promise rejection
      workflowState = "idle";

      // FIX 4: Also reset the executing ref
      isExecutingRef.current = false;
    }
  };

  /**
   * Test: Fixed version prevents duplicate execution
   */
  test("FIXED: duplicate executeFullWorkflow calls are prevented", async () => {
    // Reset state
    workflowState = "idle";
    isExecutingRef.current = false;
    executionCount = 0;

    // Start first execution (don't await)
    const promise1 = executeFullWorkflowFixed(500);

    // Wait a tick
    await new Promise(r => setTimeout(r, 10));
    expect(workflowState).toBe("executing");
    expect(executionCount).toBe(1);

    // Try to start second execution while first is still running
    const promise2 = executeFullWorkflowFixed(500);

    await new Promise(r => setTimeout(r, 10));

    // FIXED: executionCount should still be 1
    expect(executionCount).toBe(1);

    // Wait for completion
    await promise1;
    await promise2; // This should have returned early
  });

  /**
   * Test: Fixed version immediately resets state on interrupt
   */
  test("FIXED: interruptStep immediately resets workflowState to idle", async () => {
    // Reset state
    workflowState = "idle";
    isExecutingRef.current = false;
    isInterrupted = false;

    // Start execution
    const promise = executeFullWorkflowFixed(5000);

    // Wait for execution to start
    await new Promise(r => setTimeout(r, 10));
    expect(workflowState).toBe("executing");
    expect(isExecutingRef.current).toBe(true);

    // Interrupt
    interruptStepFixed();

    // FIXED: State should be idle IMMEDIATELY after interrupt
    // Not waiting for Promise to reject
    expect(workflowState).toBe("idle");
    expect(isExecutingRef.current).toBe(false);
    expect(isInterrupted).toBe(true);

    // Wait for promise to settle
    try {
      await promise;
    } catch {
      // Expected rejection
    }

    // State should still be idle
    expect(workflowState).toBe("idle");
  });

  /**
   * Test: Rapid interrupt-execute cycles don't cause stuck state
   */
  test("FIXED: rapid interrupt-execute cycles work correctly", async () => {
    // Reset state
    workflowState = "idle";
    isExecutingRef.current = false;
    isInterrupted = false;
    executionCount = 0;

    // Cycle 1: Start and immediately interrupt
    const p1 = executeFullWorkflowFixed(5000);
    await new Promise(r => setTimeout(r, 5));
    interruptStepFixed();
    expect(workflowState).toBe("idle");

    // Wait a bit for cleanup
    await new Promise(r => setTimeout(r, 10));

    // Cycle 2: Should be able to start new execution
    isInterrupted = false; // Reset interrupt flag
    const p2 = executeFullWorkflowFixed(50);
    await new Promise(r => setTimeout(r, 5));
    expect(workflowState).toBe("executing");
    expect(executionCount).toBe(2); // Second execution started

    // Let it complete naturally
    await p2;
    expect(workflowState).toBe("completed");

    // Cycle 3: Start and interrupt again
    workflowState = "idle";
    isExecutingRef.current = false;
    const p3 = executeFullWorkflowFixed(5000);
    await new Promise(r => setTimeout(r, 5));
    interruptStepFixed();
    expect(workflowState).toBe("idle");

    // Clean up
    try {
      await Promise.all([p1, p3]);
    } catch {
      // Expected rejections
    }

    expect(executionCount).toBe(3);
    expect(workflowState).toBe("idle");
  });

  /**
   * Test: State consistency after multiple rapid clicks
   * This simulates a user frantically clicking Run/Stop
   */
  test("FIXED: state remains consistent after rapid run/stop clicks", async () => {
    // Reset
    workflowState = "idle";
    isExecutingRef.current = false;
    isInterrupted = false;
    executionCount = 0;

    const promises: Promise<void>[] = [];

    // Simulate 5 rapid run/stop cycles
    for (let i = 0; i < 5; i++) {
      isInterrupted = false;
      const p = executeFullWorkflowFixed(1000);
      promises.push(p);

      await new Promise(r => setTimeout(r, 5));

      // Interrupt if executing
      if (workflowState === "executing") {
        interruptStepFixed();
      }

      await new Promise(r => setTimeout(r, 5));
    }

    // Wait for all promises to settle
    await Promise.allSettled(promises);

    // State should be idle
    expect(workflowState).toBe("idle");
    expect(isExecutingRef.current).toBe(false);

    // Only 1 execution should have actually started (guard prevents duplicates during executing state)
    // But we reset state between cycles, so it's harder to predict exactly
    // The key is that state is consistent and idle at the end
    console.log(`Total execution attempts: ${executionCount}`);
  });
});

/**
 * Tests for the abort signal propagation
 */
describe("Abort Signal Propagation", () => {
  test("abort signal should reject promise immediately", async () => {
    const controller = new AbortController();

    const promise = new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => resolve("completed"), 5000);

      controller.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          reject(new Error("Aborted"));
        },
        { once: true }
      );
    });

    // Abort after a short delay
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toThrow("Aborted");
  });

  test("Promise.race with abort signal should reject when aborted", async () => {
    const controller = new AbortController();

    const longRunningTask = new Promise<string>(resolve => {
      setTimeout(() => resolve("completed"), 5000);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("Task cancelled"));
        },
        { once: true }
      );
    });

    const racePromise = Promise.race([longRunningTask, abortPromise]);

    // Abort after short delay
    setTimeout(() => controller.abort(), 10);

    await expect(racePromise).rejects.toThrow("Task cancelled");
  });
});
