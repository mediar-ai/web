import {
    FlattenedWorkflowAnalysis,
    WorkflowStepAnalysisWithJSONB,
} from '@/types';

/**
 * Flattens a WorkflowStepAnalysis record from its JSONB data.
 * This assumes all new analyses use the llm_structured_output field.
 */
export function flattenWorkflowAnalysis(analysis: WorkflowStepAnalysisWithJSONB): FlattenedWorkflowAnalysis {
  const jsonbData = analysis.llm_structured_output || {};
  
  // V2 schema is the new standard
  return {
    id: analysis.id,
    user_id: analysis.user_id,
    session_id: analysis.session_id,
    client_timestamp: analysis.client_timestamp,
    created_at: analysis.created_at,
    source_ui_tree_event_id: analysis.source_ui_tree_event_id,
    
    // Map V2 fields to the flattened structure
    workflow: jsonbData.workflow || 'Not available', // Still here in case it's ever used
    step: jsonbData.step_title || 'No Title',
    description: jsonbData.step_summary || 'No Summary',
    facts: jsonbData.events_that_happened || 'No Events Recorded',
    logic: jsonbData.user_intent || 'No Intent Identified',
    tech: `Clicked: ${jsonbData.what_was_clicked || 'none'}. Typed: ${jsonbData.what_was_typed || 'none'}.`,
    apps: 'N/A', // V2 doesn't have an 'apps' field
    context: `Changes: ${jsonbData.how_content_changed || 'none'}. Results: ${jsonbData.results_if_any || 'none'}.`,
    
    // Metadata
    schema_version: jsonbData.schema_version || 'v2',
    raw_llm_output: jsonbData,
  };
}

/**
 * Converts an array of analyses to the new flattened format.
 */
export function flattenWorkflowAnalyses(analyses: WorkflowStepAnalysisWithJSONB[]): FlattenedWorkflowAnalysis[] {
  return analyses.map(flattenWorkflowAnalysis);
}

/**
 * Gets displayable fields from a flattened analysis, assuming V2 schema.
 */
export function getDisplayableFields(analysis: FlattenedWorkflowAnalysis): DisplayableAnalysisFields {
  const jsonbData = analysis.raw_llm_output || {};

  return {
    title: jsonbData.step_title || 'No title available',
    summary: jsonbData.step_summary || 'No summary available',
    actions: jsonbData.events_that_happened || 'No actions recorded',
    changes: jsonbData.how_content_changed || 'No changes recorded',
    results: jsonbData.results_if_any || 'No results recorded',
    clicked: jsonbData.what_was_clicked || 'No clicks recorded',
    typed: jsonbData.what_was_typed || 'No typing recorded',
    intent: jsonbData.user_intent || 'No intent identified',
    // These fields are deprecated but we provide defaults
    tech: 'N/A',
    apps: 'N/A',
    context: 'N/A',
    schemaVersion: 'v2'
  };
}

/**
 * Gets the best available title from a flattened analysis.
 */
export function getBestAvailableTitle(analysis: FlattenedWorkflowAnalysis): string {
  return analysis.raw_llm_output?.step_title || analysis.step || 'Untitled Step';
}

/**
 * Gets the best available summary from a flattened analysis.
 */
export function getBestAvailableSummary(analysis: FlattenedWorkflowAnalysis): string {
  return analysis.raw_llm_output?.step_summary || analysis.description || 'No summary available';
}

/**
 * Gets schema-appropriate fields for workflow context from a flattened analysis.
 */
export function getWorkflowContextFields(analysis: FlattenedWorkflowAnalysis): {
  workflowName: string;
  stepName: string;
  description: string;
} {
  return {
    workflowName: analysis.workflow || 'Unknown Workflow',
    stepName: analysis.raw_llm_output?.step_title || 'Untitled Step',
    description: analysis.raw_llm_output?.step_summary || 'No description'
  };
}

// NOTE: The following functions are now deprecated as we have standardized on the V2 schema.
// They are kept for reference but can be removed in a future cleanup.
// - createLegacyStructuredOutput
// - usesJSONBFormat
// - getSchemaVersion
// - extractField
// - hasV2Fields
// - migrateLegacyToJSONB
// - buildJSONBQuery
// - buildCompatibleQuery

/**
 * Enhanced interface for displayable analysis fields that works with both V1 and V2
 */
export interface DisplayableAnalysisFields {
  title: string;
  summary: string;
  actions: string;
  changes: string;
  results: string;
  clicked: string;
  typed: string;
  intent: string;
  tech: string;
  apps: string;
  context: string;
  schemaVersion: 'v1' | 'v2' | 'unknown';
} 