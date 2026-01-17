/**
 * Infer Question Type
 *
 * Analyzes the elicitation request to determine if it's an error,
 * clarification, or general question for appropriate UI styling.
 */

import { ElicitationRequest, QuestionType } from "./types";

// Keywords that suggest an error condition
const ERROR_KEYWORDS = [
  "error",
  "failed",
  "couldn't",
  "unable",
  "not found",
  "missing",
  "broken",
  "crashed",
  "exception",
  "timeout",
  "invalid",
  "wrong",
  "unexpected",
];

// Keywords that suggest clarification needed
const CLARIFY_KEYWORDS = [
  "which",
  "multiple",
  "ambiguous",
  "unclear",
  "several",
  "choose",
  "select",
  "pick",
  "found more than one",
  "many matches",
  "similar",
];

// Keywords that suggest general question
const QUESTION_KEYWORDS = [
  "what",
  "how",
  "why",
  "purpose",
  "business",
  "goal",
  "understand",
  "explain",
  "describe",
  "help me",
  "context",
];

/**
 * Infer the question type from the elicitation request.
 */
export function inferQuestionType(request: ElicitationRequest): QuestionType {
  const message = request.message.toLowerCase();

  // Check context first if available
  if (request.context?.errorType) {
    return "error";
  }

  // Check for error keywords
  if (ERROR_KEYWORDS.some(kw => message.includes(kw))) {
    return "error";
  }

  // Check for clarification keywords
  if (CLARIFY_KEYWORDS.some(kw => message.includes(kw))) {
    return "clarify";
  }

  // Check for question keywords (general questions)
  if (QUESTION_KEYWORDS.some(kw => message.includes(kw))) {
    return "question";
  }

  // Default to clarify for enum-based questions, question for free-form
  const hasEnum = Object.values(request.requestedSchema.properties).some(p => p.enum && p.enum.length > 0);

  return hasEnum ? "clarify" : "question";
}

/**
 * Generate a hash for the question to use for memory lookup.
 * Two questions with the same hash are considered "similar".
 */
export function generateQuestionHash(request: ElicitationRequest): string {
  // Normalize the message (lowercase, remove extra whitespace)
  const normalizedMessage = request.message.toLowerCase().replace(/\s+/g, " ").trim();

  // Get schema signature (property names + types)
  const schemaSignature = Object.entries(request.requestedSchema.properties)
    .map(([key, prop]) => `${key}:${prop.type}${prop.enum ? `:enum:${prop.enum.length}` : ""}`)
    .sort()
    .join("|");

  // Combine for hash
  const combined = `${normalizedMessage}::${schemaSignature}`;

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return hash.toString(36);
}

/**
 * Check if a request looks like it needs quick actions (retry/skip/help)
 * vs a full form.
 */
export function shouldShowQuickActions(request: ElicitationRequest): boolean {
  const type = inferQuestionType(request);

  // Always show quick actions for errors
  if (type === "error") return true;

  // Show if context indicates a recoverable situation
  if (request.context?.errorType) return true;

  return false;
}

/**
 * Extract the main subject from the message for display.
 * E.g., "Which Submit button should I click?" -> "Submit button"
 */
export function extractSubject(message: string): string | null {
  // Try to find quoted text
  const quotedMatch = message.match(/"([^"]+)"|'([^']+)'/);
  if (quotedMatch) {
    return quotedMatch[1] || quotedMatch[2];
  }

  // Try to find "the X" pattern
  const theMatch = message.match(/the\s+(\w+(?:\s+\w+)?)/i);
  if (theMatch) {
    return theMatch[1];
  }

  return null;
}
