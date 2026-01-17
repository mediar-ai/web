/**
 * Elicitation Types
 *
 * Types for the MCP elicitation protocol - allows the AI to ask
 * the user questions during workflow execution.
 */

// ============================================================================
// JSON Schema Types (from MCP protocol)
// ============================================================================

export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  enum?: string[];
  enumNames?: string[]; // Human-readable names for enum values
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface ElicitationSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// ============================================================================
// Elicitation Request/Response (MCP Protocol)
// ============================================================================

export interface ElicitationRequest {
  /** Human-readable message explaining what the AI needs */
  message: string;
  /** JSON Schema describing the form fields */
  requestedSchema: ElicitationSchema;
  /** Optional screenshot for element disambiguation */
  screenshot?: string;
  /** AI's suggested answer and confidence */
  suggestion?: {
    value: Record<string, unknown>;
    confidence: number; // 0-1
    reasoning?: string;
  };
  /** Metadata about what triggered this */
  context?: {
    toolName?: string;
    stepId?: string;
    errorType?: string;
  };
}

export type ElicitationAction = "accept" | "decline" | "cancel";

export interface ElicitationResponse {
  action: ElicitationAction;
  content?: Record<string, unknown>;
}

// ============================================================================
// UI Types
// ============================================================================

export type QuestionType = "error" | "clarify" | "question";

export interface QuestionTypeConfig {
  type: QuestionType;
  icon: string;
  title: string;
  accentColor: string;
  bgColor: string;
  borderColor: string;
}

export interface FormFieldConfig {
  key: string;
  property: JsonSchemaProperty;
  required: boolean;
  shortcut?: string; // For enum fields: "1", "2", etc.
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  shortcut: string;
  action: ElicitationAction;
  content?: Record<string, unknown>;
}

// ============================================================================
// State Types
// ============================================================================

export type ElicitationRenderMode = "modal" | "inline";

export interface ElicitationState {
  isOpen: boolean;
  request: ElicitationRequest | null;
  /** How to render the elicitation UI */
  renderMode: ElicitationRenderMode;
  /** For batch mode: total questions and current index */
  batch?: {
    total: number;
    current: number;
    upcoming?: string[]; // Preview of next questions
  };
}

export interface ElicitationMemoryEntry {
  questionHash: string;
  answer: Record<string, unknown>;
  timestamp: number;
  applyToSimilar: boolean;
}

// ============================================================================
// Context Types
// ============================================================================

export interface ElicitationContextValue {
  state: ElicitationState;
  /** Show elicitation modal and wait for response */
  showElicitation: (request: ElicitationRequest) => Promise<ElicitationResponse>;
  /** Respond to current elicitation */
  respond: (response: ElicitationResponse) => void;
  /** Close without responding (internal use) */
  close: () => void;
  /** Set render mode (modal or inline) */
  setRenderMode: (mode: ElicitationRenderMode) => void;
  /** Memory for remembering choices */
  memory: {
    get: (questionHash: string) => ElicitationMemoryEntry | null;
    set: (entry: ElicitationMemoryEntry) => void;
    clear: () => void;
  };
}
