/**
 * Tests for infer-question-type utility
 */

import { describe, it, expect } from "vitest";
import {
  inferQuestionType,
  generateQuestionHash,
  shouldShowQuickActions,
  extractSubject,
} from "../infer-question-type";
import { ElicitationRequest } from "../types";

function createRequest(message: string, properties: Record<string, any> = {}): ElicitationRequest {
  return {
    message,
    requestedSchema: {
      type: "object",
      properties,
    },
  };
}

describe("inferQuestionType", () => {
  it("detects error messages", () => {
    expect(inferQuestionType(createRequest("Error: Connection failed"))).toBe("error");
    expect(inferQuestionType(createRequest("Failed to open file"))).toBe("error");
  });

  it("detects clarification requests", () => {
    expect(inferQuestionType(createRequest("Which file do you mean?"))).toBe("clarify");
    expect(inferQuestionType(createRequest("Multiple matches found"))).toBe("clarify");
  });

  it("returns question for general questions", () => {
    expect(inferQuestionType(createRequest("What is your name?"))).toBe("question");
  });

  it("defaults to clarify for enum-based schemas", () => {
    const request = createRequest("Some message", {
      choice: { type: "string", enum: ["a", "b", "c"] },
    });
    expect(inferQuestionType(request)).toBe("clarify");
  });
});

describe("generateQuestionHash", () => {
  it("generates consistent hashes for same input", () => {
    const request = createRequest("Which file?", { choice: { type: "string" } });
    expect(generateQuestionHash(request)).toBe(generateQuestionHash(request));
  });

  it("generates different hashes for different messages", () => {
    const r1 = createRequest("Question 1", { choice: { type: "string" } });
    const r2 = createRequest("Question 2", { choice: { type: "string" } });
    expect(generateQuestionHash(r1)).not.toBe(generateQuestionHash(r2));
  });
});

describe("shouldShowQuickActions", () => {
  it("shows quick actions for error types", () => {
    expect(shouldShowQuickActions(createRequest("Error: Something failed"))).toBe(true);
  });

  it("does not show quick actions for question types", () => {
    expect(shouldShowQuickActions(createRequest("What is your name?", { name: { type: "string" } }))).toBe(false);
  });
});

describe("extractSubject", () => {
  it("extracts quoted text", () => {
    expect(extractSubject('Click the "Submit" button')).toBe("Submit");
  });

  it("extracts 'the X' pattern", () => {
    expect(extractSubject("Click the button")).toBe("button");
  });

  it("returns null if no subject found", () => {
    expect(extractSubject("Hello world")).toBeNull();
  });
});
