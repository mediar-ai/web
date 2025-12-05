/**
 * Local type definitions for Vertex AI REST API
 * These match the Gemini/Vertex AI API schema and allow SDK-independent usage
 */

/** A part of a multi-part content message */
export interface Part {
  /** Text content */
  text?: string;
  /** Function call from model */
  functionCall?: FunctionCall;
  /** Function response to model */
  functionResponse?: FunctionResponse;
  /** Inline data (e.g., images) */
  inlineData?: Blob;
  /** File data reference */
  fileData?: FileData;
  /** Indicates if this is a thought/reasoning step */
  thought?: boolean;
  /** Code execution result */
  codeExecutionResult?: CodeExecutionResult;
  /** Executable code */
  executableCode?: ExecutableCode;
}

/** A content message in the conversation */
export interface Content {
  /** The role of the content producer: 'user' or 'model' */
  role?: string;
  /** The parts that make up this content */
  parts?: Part[];
}

/** A function call made by the model */
export interface FunctionCall {
  /** The name of the function to call */
  name: string;
  /** The arguments to pass to the function */
  args?: Record<string, unknown>;
}

/** A response to a function call */
export interface FunctionResponse {
  /** The name of the function that was called */
  name: string;
  /** The response from the function */
  response: unknown;
}

/** Declaration of a function that the model can call */
export interface FunctionDeclaration {
  /** The name of the function */
  name?: string;
  /** Description of what the function does */
  description?: string;
  /** JSON Schema describing the function parameters */
  parameters?: Schema;
}

/** JSON Schema for function parameters */
export interface Schema {
  /** The type of the schema (STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT) */
  type?: SchemaType | Type;
  /** Format hint (e.g., 'date-time', 'email') */
  format?: string;
  /** Description of this schema element */
  description?: string;
  /** Whether this field can be null */
  nullable?: boolean;
  /** Enum values for STRING type */
  enum?: string[];
  /** For OBJECT type: the properties */
  properties?: Record<string, Schema>;
  /** For OBJECT type: required property names */
  required?: string[];
  /** For ARRAY type: schema of array items */
  items?: Schema;
}

/** Schema types matching Vertex AI */
export type SchemaType = 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';

/** Type enum matching @google/genai Type enum - for use in tool definitions */
export enum Type {
  TYPE_UNSPECIFIED = 'TYPE_UNSPECIFIED',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
  NULL = 'NULL',
}

/** Inline blob data */
export interface Blob {
  /** MIME type of the data */
  mimeType?: string;
  /** Base64-encoded data */
  data?: string;
}

/** Reference to a file */
export interface FileData {
  /** MIME type of the file */
  mimeType?: string;
  /** URI of the file */
  fileUri?: string;
}

/** Result of code execution */
export interface CodeExecutionResult {
  /** The outcome of the execution */
  outcome?: string;
  /** The output from execution */
  output?: string;
}

/** Code to be executed */
export interface ExecutableCode {
  /** The programming language */
  language?: string;
  /** The code to execute */
  code?: string;
}

/** Generation configuration for the model */
export interface GenerationConfig {
  /** Temperature for sampling (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxOutputTokens?: number;
  /** Top-p sampling */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Thinking configuration for Gemini 3+ */
  thinkingConfig?: ThinkingConfig;
}

/** Thinking configuration for Gemini 3+ models */
export interface ThinkingConfig {
  /** Thinking level: 'low' for fast, 'high' for complex reasoning */
  thinkingLevel?: 'low' | 'high';
}

/** Request body for generateContent API */
export interface GenerateContentRequest {
  /** The conversation contents */
  contents: Content[];
  /** Generation configuration */
  generationConfig?: GenerationConfig;
  /** System instruction */
  systemInstruction?: Content;
  /** Tools available to the model */
  tools?: Tool[];
}

/** Tool configuration */
export interface Tool {
  /** Function declarations */
  functionDeclarations?: FunctionDeclaration[];
}

/** Response from generateContent API */
export interface GenerateContentResponse {
  /** The generated candidates */
  candidates?: Candidate[];
  /** Usage metadata */
  usageMetadata?: UsageMetadata;
  /** Model version used */
  modelVersion?: string;
}

/** A generated candidate response */
export interface Candidate {
  /** The content of this candidate */
  content?: Content;
  /** Reason generation finished */
  finishReason?: string;
  /** Safety ratings */
  safetyRatings?: SafetyRating[];
  /** Citation metadata */
  citationMetadata?: CitationMetadata;
  /** Index of this candidate */
  index?: number;
}

/** Token usage metadata */
export interface UsageMetadata {
  /** Tokens in the prompt */
  promptTokenCount?: number;
  /** Tokens in the candidates */
  candidatesTokenCount?: number;
  /** Total tokens used */
  totalTokenCount?: number;
}

/** Safety rating for content */
export interface SafetyRating {
  /** The safety category */
  category?: string;
  /** The probability level */
  probability?: string;
}

/** Citation metadata */
export interface CitationMetadata {
  /** List of citations */
  citations?: Citation[];
}

/** A citation source */
export interface Citation {
  /** Start index in the response */
  startIndex?: number;
  /** End index in the response */
  endIndex?: number;
  /** URI of the source */
  uri?: string;
  /** Title of the source */
  title?: string;
  /** License of the source */
  license?: string;
}
