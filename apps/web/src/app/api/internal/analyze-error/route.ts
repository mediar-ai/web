import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google/genai';
import { trackLLMUsageAsync } from '@/lib/llm-tracking';
import { requireInternalApiKey } from '@/lib/auth/requireInternalApiKey';

const MAX_RETRIES = 3;
const MAX_TOKEN_SIZE = 100000; // Approximate character limit

interface ErrorAnalysisRequest {
  executionId: string;
  workflowId: string;
  error: any;
  logs?: string;
  results?: any;
  metadata?: any;
}

async function analyzeWithVertexAI(data: ErrorAnalysisRequest): Promise<string> {
  try {
    // Use the same Vertex AI configuration as the rest of the app
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash', // Using the faster model for quick error analysis
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });

    // Prepare the context, truncating if necessary
    let context = {
      error: JSON.stringify(data.error).slice(0, 30000),
      logs: data.logs?.slice(0, 30000) || 'No logs available',
      results: JSON.stringify(data.results).slice(0, 20000),
      metadata: JSON.stringify(data.metadata).slice(0, 10000),
    };

    const totalSize = Object.values(context).join('').length;
    if (totalSize > MAX_TOKEN_SIZE) {
      // Further truncate if needed
      context = {
        ...context,
        logs: context.logs.slice(0, 15000),
        results: context.results.slice(0, 10000),
      };
    }

    const prompt = `You are an expert at debugging workflow automation failures, especially OneDrive to SAP integrations.

Analyze this workflow execution failure and provide a structured, actionable analysis.

WORKFLOW: OneDrive to SAP Journal Entry Automation
EXECUTION ID: ${data.executionId}

ERROR INFORMATION:
${context.error}

EXECUTION LOGS (last entries):
${context.logs}

RESULTS DATA:
${context.results}

METADATA:
${context.metadata}

Please provide a structured analysis with these exact sections:

**Root Cause:** (1-2 sentences explaining what specifically went wrong)

**Impact:** (Which journal entry/item failed and why - be specific)

**Solution:**
- [Specific step 1 to fix this]
- [Specific step 2 to fix this]
- [Specific step 3 if needed]

**Prevention:**
- [How to avoid this error in the future]
- [Any configuration changes needed]

Focus on these common issues:
1. MCP connection timeouts (http://172.178.65.145:8080/mcp or similar endpoints)
2. SAP session timeouts or login failures
3. Element not found errors (SAP UI changes)
4. Data format mismatches (dates, amounts, account codes)
5. Network connectivity issues
6. Azure VM/service availability

Be specific about:
- Exact error messages and what they mean
- Which MCP endpoint is failing
- What SAP screen/element is problematic
- What data validation is needed`;

    console.log('🤖 Analyzing error with Vertex AI (gemini-2.5-flash)');

    // Generate content using Vertex AI
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1500,
        topP: 0.95,
        topK: 20,
      },
    });

    // Track LLM usage
    trackLLMUsageAsync({
      model: 'gemini-2.5-flash',
      inputTokens: result.response?.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.response?.usageMetadata?.candidatesTokenCount || 0,
      source: 'error_analysis',
    });

    // Extract the response text
    const response = result.response;

    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const analysis = response.candidates[0].content.parts[0].text;
      console.log('✅ Vertex AI error analysis generated successfully');
      return analysis;
    }

    console.error('No valid response from Vertex AI model:', response);
    throw new Error('Failed to get valid response from Vertex AI');

  } catch (error) {
    console.error('Vertex AI analysis failed:', error);

    // Check if it's a configuration issue
    if (error instanceof Error && error.message.includes('credentials')) {
      console.error('❌ Vertex AI credentials not configured properly');
      console.error('Please ensure GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY are set');
    }

    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Require the internal API key. This route triggers LLM (Vertex AI) calls,
    // so it must not be callable by unauthenticated clients.
    const denied = requireInternalApiKey(req);
    if (denied) return denied;

    const body: ErrorAnalysisRequest = await req.json();

    // Validate required fields
    if (!body.executionId || !body.workflowId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Fetch additional execution data from database
    const { data: execution } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', body.executionId)
      .single();

    if (execution) {
      body.metadata = {
        ...body.metadata,
        duration: execution.duration,
        started_at: execution.started_at,
        completed_at: execution.completed_at,
        machine_id: execution.machine_id,
      };
    }

    let errorAnalysis = '';
    let retries = 0;
    let lastError: any = null;

    // Try Vertex AI with retries
    while (retries < MAX_RETRIES && !errorAnalysis) {
      try {
        errorAnalysis = await analyzeWithVertexAI(body);
        break;
      } catch (error) {
        lastError = error;
        retries++;

        // If it's a credentials issue, don't retry
        if (error instanceof Error && error.message.includes('credentials')) {
          console.error('Credential error detected, falling back to basic analysis');
          break;
        }

        if (retries < MAX_RETRIES) {
          // Wait before retry with exponential backoff
          const delay = 1000 * Math.pow(2, retries - 1);
          console.log(`🔄 Retrying Vertex AI analysis in ${delay}ms (attempt ${retries}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Fallback to basic analysis if Vertex AI failed
    if (!errorAnalysis && lastError) {
      console.error('Failed to generate AI analysis after retries:', lastError);
      console.log('📝 Using basic error analysis as fallback');
      errorAnalysis = generateBasicAnalysis(body);
    }

    // Store the analysis in the database
    const { error: updateError } = await supabase
      .from('workflow_executions')
      .update({
        error_analysis: errorAnalysis,
        error_analyzed_at: new Date().toISOString(),
      })
      .eq('id', body.executionId);

    if (updateError) {
      console.error('Failed to update database:', updateError);
    }

    return NextResponse.json({
      success: true,
      analysis: errorAnalysis,
      executionId: body.executionId,
    });

  } catch (error) {
    console.error('Error analysis failed:', error);
    return NextResponse.json(
      { error: 'Failed to analyze error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function generateBasicAnalysis(data: ErrorAnalysisRequest): string {
  const error = data.error;
  let analysis = '## Error Analysis\n\n';

  // Detect common MCP/SAP errors
  if (error?.message?.includes('ConnectTimeout') || error?.message?.includes('http://172.178.65.145:8080/mcp')) {
    analysis += '**Root Cause:** MCP connection timeout - The automation server is not responding.\n\n';
    analysis += '**Solution:**\n';
    analysis += '- Check if the MCP server at 172.178.65.145 is running\n';
    analysis += '- Verify network connectivity\n';
    analysis += '- Restart the MCP service on the Azure VM\n';
    analysis += '- Check Azure NSG rules for port 8080\n\n';
  } else if (error?.type === 'Exception' && data.logs?.includes('mcp_connection')) {
    analysis += '**Root Cause:** MCP automation service connection failed.\n\n';
    analysis += '**Solution:**\n';
    analysis += '- Verify the MCP endpoint is accessible\n';
    analysis += '- Check if browser automation dependencies are installed\n';
    analysis += '- Review the machine\'s health status in the dashboard\n\n';
  } else if (data.logs?.includes('SAP') || data.logs?.includes('journal')) {
    analysis += '**Root Cause:** SAP navigation or data entry error.\n\n';
    analysis += '**Common Issues:**\n';
    analysis += '- SAP session timeout\n';
    analysis += '- Element selectors changed in SAP UI\n';
    analysis += '- Required fields missing data\n';
    analysis += '- Date format mismatch\n\n';
    analysis += '**Solution:**\n';
    analysis += '- Verify SAP login credentials\n';
    analysis += '- Check if SAP UI has been updated\n';
    analysis += '- Validate input data format\n';
    analysis += '- Increase wait times for SAP page loads\n\n';
  } else {
    analysis += `**Error Type:** ${error?.type || 'Unknown'}\n`;
    analysis += `**Error Message:** ${error?.message || 'No message available'}\n\n`;
    analysis += '**General Troubleshooting:**\n';
    analysis += '- Review the execution logs for specific failure points\n';
    analysis += '- Check if the workflow completed any steps successfully\n';
    analysis += '- Verify all required environment variables are set\n';
    analysis += '- Ensure the MCP agent has necessary permissions\n\n';
  }

  analysis += '**Prevention:**\n';
  analysis += '- Implement retry logic for transient failures\n';
  analysis += '- Add validation for input data before processing\n';
  analysis += '- Monitor MCP server health regularly\n';
  analysis += '- Set up alerts for connection failures\n';

  return analysis;
}