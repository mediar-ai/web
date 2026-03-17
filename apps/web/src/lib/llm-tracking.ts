import { createClient } from '@supabase/supabase-js';

export type LLMSource =
  | 'web_ai'
  | 'claude_code'
  | 'execution_qa'
  | 'vision_parse'
  | 'computer_use'
  | 'workflow_synthesis'
  | 'workflow_analysis'
  | 'search_analysis'
  | 'error_analysis'
  | 'label_suggestion'
  | 'workflow_edit'
  | 'step_processing'
  | 'parser_validation'
  | 'desktop_report'
  | 'stream_proxy'
  | 'workflow_event'
  | 'workflow_list_edit'
  | 'workflow_export'
  | 'activity_analysis'
  | 'user_message_analysis';

interface TrackLLMUsageParams {
  userId?: string;  // Optional - defaults to 'system' for internal routes
  orgId?: string;   // Optional - defaults to 'system' for internal routes
  model: string;
  inputTokens: number;
  outputTokens: number;
  source: LLMSource;
}

/**
 * Track LLM usage in mediar_llm_traces table.
 * Fire-and-forget - errors are logged but don't throw.
 */
export async function trackLLMUsage(params: TrackLLMUsageParams): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn('[LLM Tracking] Supabase not configured');
      return;
    }

    console.log(
      `[LLM Tracking] ${params.source}: model=${params.model}, input=${params.inputTokens}, output=${params.outputTokens}, userId=${params.userId || 'system(missing)'}`
    );

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase.from('mediar_llm_traces').insert({
      user_id: params.userId || 'system',
      org_id: params.orgId || 'system',
      model: params.model,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      source: params.source,
    });

    if (error) {
      console.error('[LLM Tracking] Insert failed:', error);
    }
  } catch (e) {
    console.error('[LLM Tracking] Error:', e);
  }
}

/**
 * Fire-and-forget version - returns immediately without waiting.
 * Use when you don't want to block the response.
 */
export function trackLLMUsageAsync(params: TrackLLMUsageParams): void {
  trackLLMUsage(params).catch((e) => {
    console.error('[LLM Tracking] Async error:', e);
  });
}
