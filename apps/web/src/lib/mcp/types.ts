// MCP Server types for Next.js integration
export interface WorkflowRecord {
  id: number;
  name: string;
  description?: string;
  status: string;
  category?: string;
  automation_sequence: AutomationSequence[];
  estimated_duration_seconds?: number;
  version?: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationSequence {
  tool_name: string;
  arguments: {
    variables?: Record<string, WorkflowVariable>;
    inputs?: Record<string, unknown>;
    selectors?: Record<string, string>;
    steps?: WorkflowStep[];
    output_parser?: {
      fieldsToExtract?: Record<string, unknown>;
    };
  };
}

export interface WorkflowVariable {
  type?: string;
  label?: string;
  description?: string;
  default?: unknown;
  options?: string[] | Array<{value: string; label: string}>;
  regex?: string;
  validation_message?: string;
  required?: boolean;
  controls?: Record<string, Record<string, WorkflowVariable>>;
  // Internal metadata for schema analysis
  _originalName?: string;
  _branchValue?: string;
}

export interface WorkflowStep {
  tool_name?: string;
  group_name?: string;
  if?: string;
  skippable?: boolean;
  steps?: WorkflowStep[];
  arguments?: Record<string, unknown>;
  delay_ms?: number;
  continue_on_error?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
  };
  metadata?: {
    workflow_id: number;
    workflow_name: string;
    category?: string;
    estimated_duration_seconds?: number;
    parameter_count: number;
    execution_count?: number;
  };
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface MCPRequest {
  method: 'tools/list' | 'tools/call';
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

export interface MCPResponse {
  tools?: MCPTool[];
  content?: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface CachedTool {
  tool: MCPTool;
  workflow: WorkflowRecord;
  lastUpdated: number;
}

export interface SchemaAnalysisResult {
  coreVariables: Record<string, WorkflowVariable>;
  conditionalVariables: Record<string, WorkflowVariable>;
} 