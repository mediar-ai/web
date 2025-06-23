import { 
  WorkflowStepAnalysisWithJSONB, 
  FlattenedWorkflowAnalysis, 
  LLMStructuredOutput 
} from '@/types';

/**
 * Flattens a WorkflowStepAnalysis record, prioritizing JSONB data over legacy columns
 */
export function flattenWorkflowAnalysis(analysis: WorkflowStepAnalysisWithJSONB): FlattenedWorkflowAnalysis {
  const jsonbData = analysis.llm_structured_output;
  
  return {
    id: analysis.id,
    user_id: analysis.user_id,
    session_id: analysis.session_id,
    client_timestamp: analysis.client_timestamp,
    created_at: analysis.created_at,
    
    // Prioritize JSONB data, fallback to legacy columns
    workflow: jsonbData?.workflow || analysis.workflow || 'Not available in data',
    step: jsonbData?.step || analysis.step || 'Not available in data',
    description: jsonbData?.description || analysis.description || 'Not available in data',
    facts: jsonbData?.facts || analysis.facts || 'Not available in data',
    logic: jsonbData?.logic || analysis.logic || 'Not available in data',
    tech: jsonbData?.tech || analysis.tech || 'Not available in data',
    apps: jsonbData?.apps || analysis.apps || 'Not available in data',
    context: jsonbData?.context || analysis.context || 'Not available in data',
    
    // Additional metadata
    schema_version: jsonbData?.schema_version,
    raw_llm_output: jsonbData,
  };
}

/**
 * Converts an array of analyses to flattened format
 */
export function flattenWorkflowAnalyses(analyses: WorkflowStepAnalysisWithJSONB[]): FlattenedWorkflowAnalysis[] {
  return analyses.map(flattenWorkflowAnalysis);
}

/**
 * Creates LLM structured output in the legacy v1 format
 */
export function createLegacyStructuredOutput(data: {
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
}): LLMStructuredOutput {
  return {
    ...data,
    schema_version: 'v1_legacy',
    generation_timestamp: new Date().toISOString(),
  };
}

/**
 * Creates LLM structured output in the new v2 format
 */
export function createV2StructuredOutput(data: {
  step_title: string;
  step_summary: string;
  events_that_happened: string;
  how_content_changed: string;
  results_if_any: string;
  what_was_clicked: string;
  what_was_typed: string;
  user_intent: string;
}): LLMStructuredOutput {
  return {
    ...data,
    schema_version: 'v2_new',
    generation_timestamp: new Date().toISOString(),
  };
}

/**
 * Determines if an analysis uses the new JSONB format
 */
export function usesJSONBFormat(analysis: WorkflowStepAnalysisWithJSONB): boolean {
  return analysis.llm_structured_output !== null && analysis.llm_structured_output !== undefined;
}

/**
 * Gets the schema version of an analysis
 */
export function getSchemaVersion(analysis: WorkflowStepAnalysisWithJSONB): string {
  if (analysis.llm_structured_output?.schema_version) {
    return analysis.llm_structured_output.schema_version;
  }
  return usesJSONBFormat(analysis) ? 'unknown_jsonb' : 'legacy_columns';
}

/**
 * Safely extracts a field from either JSONB or legacy columns
 */
export function extractField(
  analysis: WorkflowStepAnalysisWithJSONB, 
  field: keyof FlattenedWorkflowAnalysis
): string {
  const flattened = flattenWorkflowAnalysis(analysis);
  return flattened[field] as string || 'Not available in data';
}

/**
 * Checks if an analysis has v2 schema fields
 */
export function hasV2Fields(analysis: WorkflowStepAnalysisWithJSONB): boolean {
  const jsonb = analysis.llm_structured_output;
  if (!jsonb) return false;
  
  const v2Fields = [
    'step_title', 'step_summary', 'events_that_happened', 
    'how_content_changed', 'results_if_any', 'what_was_clicked', 
    'what_was_typed', 'user_intent'
  ];
  
  return v2Fields.some(field => jsonb[field] !== undefined);
}

/**
 * Migrates legacy column data to JSONB format
 */
export function migrateLegacyToJSONB(analysis: WorkflowStepAnalysisWithJSONB): LLMStructuredOutput {
  return createLegacyStructuredOutput({
    workflow: analysis.workflow || 'Not available in data',
    step: analysis.step || 'Not available in data',
    description: analysis.description || 'Not available in data',
    facts: analysis.facts || 'Not available in data',
    logic: analysis.logic || 'Not available in data',
    tech: analysis.tech || 'Not available in data',
    apps: analysis.apps || 'Not available in data',
    context: analysis.context || 'Not available in data',
  });
}

/**
 * Query helper for JSONB fields - generates SQL for filtering
 */
export function buildJSONBQuery(field: string, value: string): string {
  return `llm_structured_output->>'${field}' = '${value}'`;
}

/**
 * Query helper for backward compatible field access
 */
export function buildCompatibleQuery(field: string, value: string): string {
  return `(COALESCE(llm_structured_output->>'${field}', ${field}) = '${value}')`;
} 