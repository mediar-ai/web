import { createClient } from '@supabase/supabase-js';

// Types for labeling data operations
export interface LabelingData {
  low_level_workflow_analysis_id: number;
  selected_labels: string[] | null;
  suggested_labels: string[] | null;
}

export interface LabelingContext {
  selected_labels: string[];
  suggested_labels: string[];
}

export interface AnalysisWithLabeling {
  id: string | number;
  timestamp?: string;
  client_timestamp?: string;
  analysis?: Record<string, unknown>;
  llm_structured_output?: Record<string, unknown>;
  window_title?: string;
  selected_labels?: string[];
  suggested_labels?: string[];
  [key: string]: unknown;
}

/**
 * Fetches labeling data for given analysis IDs
 */
export async function fetchLabelingData(analysisIds: number[]): Promise<Map<number, LabelingContext>> {
  if (analysisIds.length === 0) {
    return new Map();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('[WARN] Supabase environment variables not available for labeling data fetch');
    return new Map();
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data: labelingData, error: labelingError } = await supabase
    .from('low_level_workflow_labeling')
    .select('low_level_workflow_analysis_id, selected_labels, suggested_labels')
    .in('low_level_workflow_analysis_id', analysisIds);

  if (labelingError) {
    console.warn('[WARN] Error fetching labeling data:', labelingError);
    return new Map();
  }

  // Create labeling map
  const labelingMap = new Map<number, LabelingContext>();
  (labelingData as LabelingData[])?.forEach(label => {
    labelingMap.set(label.low_level_workflow_analysis_id, {
      selected_labels: label.selected_labels || [],
      suggested_labels: label.suggested_labels || []
    });
  });

  return labelingMap;
}

/**
 * Enhances an analysis object with labeling data
 */
export function enhanceAnalysisWithLabeling(
  analysis: AnalysisWithLabeling, 
  labelingMap: Map<number, LabelingContext>
): AnalysisWithLabeling {
  const analysisId = parseInt(analysis.id.toString());
  const labelingContext = labelingMap.get(analysisId);
  
  if (labelingContext) {
    return {
      ...analysis,
      selected_labels: labelingContext.selected_labels,
      suggested_labels: labelingContext.suggested_labels
    };
  }
  
  return analysis;
}

/**
 * Enhances multiple analyses with labeling data
 */
export function enhanceAnalysesWithLabeling(
  analyses: AnalysisWithLabeling[], 
  labelingMap: Map<number, LabelingContext>
): AnalysisWithLabeling[] {
  return analyses.map(analysis => enhanceAnalysisWithLabeling(analysis, labelingMap));
}

/**
 * Extracts analysis IDs from various data structures
 */
export function extractAnalysisIds(data: {
  targetAnalysis?: { id?: string | number };
  neighborAnalyses?: Array<{ id?: string | number }>;
  analyses?: Array<{ id?: string | number }>;
  analysesData?: Array<{ id?: string | number }>;
}): number[] {
  const ids: number[] = [];

  // Extract from target analysis
  if (data.targetAnalysis?.id) {
    ids.push(parseInt(data.targetAnalysis.id.toString()));
  }

  // Extract from neighbor analyses
  if (data.neighborAnalyses && Array.isArray(data.neighborAnalyses)) {
    data.neighborAnalyses.forEach(neighbor => {
      if (neighbor.id) {
        ids.push(parseInt(neighbor.id.toString()));
      }
    });
  }

  // Extract from analyses array
  if (data.analyses && Array.isArray(data.analyses)) {
    data.analyses.forEach(analysis => {
      if (analysis.id) {
        ids.push(parseInt(analysis.id.toString()));
      }
    });
  }

  // Extract from analysesData array
  if (data.analysesData && Array.isArray(data.analysesData)) {
    data.analysesData.forEach(analysis => {
      if (analysis.id) {
        ids.push(parseInt(analysis.id.toString()));
      }
    });
  }

  return [...new Set(ids)]; // Remove duplicates
}

/**
 * Creates a combined labeling context summary for prompts
 */
export function createLabelingSummary(labeling: LabelingContext): string {
  const parts: string[] = [];
  
  if (labeling.selected_labels && labeling.selected_labels.length > 0) {
    parts.push(`LLM Generated Labels: ${labeling.selected_labels.join(', ')}`);
  }
  
  if (labeling.suggested_labels.length > 0) {
    parts.push(`AI Labels: ${labeling.suggested_labels.join(', ')}`);
  }
  
  return parts.length > 0 ? parts.join(' | ') : 'No labels';
}

/**
 * Formats labeling data for inclusion in prompts
 */
export function formatLabelingForPrompt(
  analysisWithLabeling: AnalysisWithLabeling,
  contextName: string = 'Analysis'
): string {
  const labelingContext: LabelingContext = {
    selected_labels: analysisWithLabeling.selected_labels || [],
    suggested_labels: analysisWithLabeling.suggested_labels || []
  };
  
  const summary = createLabelingSummary(labelingContext);
  return `${contextName} Labels: ${summary}`;
} 