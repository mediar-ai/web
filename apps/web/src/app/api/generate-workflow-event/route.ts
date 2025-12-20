import { NextRequest, NextResponse } from 'next/server';
// import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google/genai';
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT } from '@/lib/prompts';
import { createClient } from '@supabase/supabase-js';
import { trackLLMUsageAsync } from '@/lib/llm-tracking';
// import { v2AnalysisSchema } from '@/lib/llmSchemas';

// const getGenAI = () => {
//   const apiKey = process.env.GEMINI_API_KEY;
//   if (!apiKey) {
//     throw new Error('GEMINI_API_KEY is not set.');
//   }
//   return new GoogleGenerativeAI(apiKey);
// };

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// Helper function to determine if an error is retryable
function isRetryableError(error: any): boolean {
  const errorMessage = error?.message || String(error);
  const errorString = errorMessage.toLowerCase();
  
  const retryablePatterns = [
    '503',
    'service unavailable',
    '429',
    'too many requests',
    'rate limit',
    '500',
    'internal server error',
    'timeout',
    'econnreset',
    'enotfound',
    'unavailable',
    'visibility check was unavailable',
  ];
  
  return retryablePatterns.some(pattern => errorString.includes(pattern));
}

// Helper function to retry Vertex AI generateContent with exponential backoff
async function generateContentWithRetry(
  model: any,
  params: any,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
  } = {}
): Promise<any> {
  const { maxRetries = 3, baseDelayMs = 1000 } = options;
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`[WORKFLOW-EVENT-RETRY] Attempt ${attempt + 1}/${maxRetries + 1} - waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      console.log(`[WORKFLOW-EVENT-HTTP] Calling Vertex AI generateContent (attempt ${attempt + 1}/${maxRetries + 1})`);
      const result = await model.generateContent(params);
      
      if (attempt > 0) {
        console.log(`[WORKFLOW-EVENT-RETRY] ✅ Success after ${attempt} retries`);
      }
      
      return result;
      
    } catch (error: any) {
      lastError = error;
      
      const isRetryable = isRetryableError(error);
      console.error(`[WORKFLOW-EVENT-HTTP] API error:`, {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        errorType: error?.constructor?.name || 'Unknown',
        errorMessage: error?.message || String(error),
        isRetryable,
      });
      
      if (!isRetryable) {
        console.error(`[WORKFLOW-EVENT-HTTP] Non-retryable error detected, failing immediately`);
        throw error;
      }
      
      if (attempt >= maxRetries) {
        console.error(`[WORKFLOW-EVENT-HTTP] Max retries (${maxRetries + 1}) exhausted`);
        throw new Error(
          `Vertex AI request failed after ${maxRetries + 1} attempts: ${error?.message || String(error)}`
        );
      }
      
      console.log(`[WORKFLOW-EVENT-HTTP] Retryable error detected, will retry...`);
    }
  }
  
  throw lastError;
}

// Type for labeling data enhancement
interface LabelingData {
  low_level_workflow_analysis_id: number;
  selected_labels: string[] | null;
  suggested_labels: string[] | null;
}

// Type for analysis with optional labeling data
interface AnalysisWithLabels {
  id?: string | number;
  selected_labels?: string[];
  suggested_labels?: string[];
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Enhanced context with labeling data
    const enhancedContext = { ...context };

    // Check if we have analysis IDs to fetch labeling data
    const analysisIds: number[] = [];
    
    // Extract target analysis ID
    if (context.targetAnalysis?.id) {
      analysisIds.push(parseInt(context.targetAnalysis.id));
    }
    
    // Extract neighbor analysis IDs
    if (context.neighborAnalyses && Array.isArray(context.neighborAnalyses)) {
      context.neighborAnalyses.forEach((neighbor: AnalysisWithLabels) => {
        if (neighbor.id) {
          analysisIds.push(parseInt(neighbor.id.toString()));
        }
      });
    }

    // Fetch labeling data if we have analysis IDs
    if (analysisIds.length > 0) {
      console.log(`🏷️ Fetching labeling data for ${analysisIds.length} analyses...`);
      
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data: labelingData, error: labelingError } = await supabase
          .from('low_level_workflow_labeling')
          .select('low_level_workflow_analysis_id, selected_labels, suggested_labels')
          .in('low_level_workflow_analysis_id', analysisIds);

        if (labelingError) {
          console.warn('[WARN] Error fetching labeling data:', labelingError);
        } else {
          // Create labeling map
          const labelingMap = new Map<number, { selected_labels: string[]; suggested_labels: string[] }>();
          (labelingData as LabelingData[])?.forEach(label => {
            labelingMap.set(label.low_level_workflow_analysis_id, {
              selected_labels: label.selected_labels || [],
              suggested_labels: label.suggested_labels || []
            });
          });

          // Enhance target analysis with labeling data
          if (context.targetAnalysis?.id) {
            const targetId = parseInt(context.targetAnalysis.id);
            const targetLabels = labelingMap.get(targetId);
            if (targetLabels) {
              enhancedContext.targetAnalysis = {
                ...context.targetAnalysis,
                selected_labels: targetLabels.selected_labels,
                suggested_labels: targetLabels.suggested_labels
              };
            }
          }

          // Enhance neighbor analyses with labeling data
          if (context.neighborAnalyses && Array.isArray(context.neighborAnalyses)) {
            enhancedContext.neighborAnalyses = context.neighborAnalyses.map((neighbor: AnalysisWithLabels) => {
              if (neighbor.id) {
                const neighborId = parseInt(neighbor.id.toString());
                const neighborLabels = labelingMap.get(neighborId);
                if (neighborLabels) {
                  return {
                    ...neighbor,
                    selected_labels: neighborLabels.selected_labels,
                    suggested_labels: neighborLabels.suggested_labels
                  };
                }
              }
              return neighbor;
            });
          }

          console.log(`🏷️ Enhanced context with labeling data for target and ${enhancedContext.neighborAnalyses?.length || 0} neighbors`);
        }
      }
    }

    // 🔥 SWITCHED TO VERTEX AI 🔥
    console.log('🚀 Using Vertex AI for workflow event generation with model:', modelName);
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
    });
    
    const prompt = `${WORKFLOW_STEP_ANALYSIS_V2_PROMPT}

ENHANCED LABELING CONTEXT:
The context below may include LLM-generated labels (selected_labels) and AI-suggested labels (suggested_labels) for the target analysis and neighboring analyses. Use this labeling data to:
- Better understand the semantic context and workflow patterns
- Generate more accurate and contextually-aware step summaries
- Align the generated event with established labeling categories
- Prioritize LLM-generated labels over AI-suggested labels when making decisions

CONTEXT:
${JSON.stringify(enhancedContext, null, 2)}

Please respond with a JSON object in this exact format:
{
  "step_title": "Clear, action-oriented title for this step",
  "step_summary": "Brief summary of what the user accomplished in this step",
  "events_that_happened": "Specific user actions: clicks, keystrokes, navigation, scrolling, etc.",
  "how_content_changed": "What changed on the screen as a result of the user's actions",
  "results_if_any": "Outcomes, confirmations, errors, notifications, or responses from the system",
  "what_was_clicked": "Specific UI elements that were clicked",
  "what_was_typed": "Text input by the user, if any",
  "user_intent": "The user's likely goal or intention behind this action"
}`;
    
    const result = await generateContentWithRetry(
      model,
      prompt,
      {
        maxRetries: 3,
        baseDelayMs: 1000,
      }
    );

    // Track LLM usage (fire-and-forget)
    const usageMetadata = result.response?.usageMetadata;
    if (usageMetadata) {
      console.log(`[WORKFLOW-EVENT] tracking usage: in=${usageMetadata.promptTokenCount}, out=${usageMetadata.candidatesTokenCount}`);
      trackLLMUsageAsync({
        model: modelName,
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        source: 'workflow_event',
      });
    }

    // 🔥 VERTEX AI RESPONSE HANDLING 🔥
    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const rawText = response.candidates[0].content.parts[0].text;
        console.log('📄 Raw Vertex AI response:', rawText.substring(0, 200) + '...');
        
        // Handle markdown-formatted JSON (remove ```json and ``` markers)
        let cleanedText = rawText.trim();
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        try {
          const analysisData = JSON.parse(cleanedText);
          console.log('[SUCCESS] Vertex AI workflow event generation successful');
        
        // Add schema version to mark as V2
        const v2Analysis = {
          ...analysisData,
          schema_version: 'v2'
        };
        
        return NextResponse.json(v2Analysis);
        } catch (parseError) {
          console.error('[ERROR] Failed to parse Vertex AI response as JSON:', parseError);
          console.log('🔍 Cleaned text:', cleanedText.substring(0, 300));
          return NextResponse.json({ 
            error: 'Invalid JSON response from Vertex AI',
            details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
            rawResponse: rawText.substring(0, 500)
          }, { status: 500 });
        }
    }
    
    console.error("No valid response from Vertex AI model:", response);
    return NextResponse.json({ error: 'Failed to generate workflow analysis from the Vertex AI model.' }, { status: 500 });

  } catch (error) {
    console.error('Error generating workflow event with Vertex AI:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 