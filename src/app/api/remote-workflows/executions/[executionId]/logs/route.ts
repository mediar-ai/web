import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Transform execution_logs to the format expected by the UI
const transformExecutionLogs = (logs: any): any[] => {
  if (!logs) return [];

  // If logs is already in the correct format (array of objects with timestamp, level, message)
  if (Array.isArray(logs) && logs.length > 0 && typeof logs[0] === 'object' && 'message' in logs[0]) {
    return logs;
  }

  // If logs is an array of strings, transform to expected format
  if (Array.isArray(logs)) {
    return logs.map((log: any) => {
      // Try to parse timestamp and level from string format like "[2025-09-23T00:11:42.828574] Starting workflow..."
      const timestampMatch = String(log).match(/^\[([^\]]+)\]/);
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
      const messageWithoutTimestamp = String(log).replace(/^\[[^\]]+\]\s*/, '');

      // Try to detect log level from message content
      let level = 'info';
      if (messageWithoutTimestamp.toLowerCase().includes('error') || messageWithoutTimestamp.toLowerCase().includes('fail')) {
        level = 'error';
      } else if (messageWithoutTimestamp.toLowerCase().includes('warn')) {
        level = 'warn';
      } else if (messageWithoutTimestamp.toLowerCase().includes('success') || messageWithoutTimestamp.toLowerCase().includes('complet')) {
        level = 'success';
      }

      return {
        timestamp,
        level,
        message: messageWithoutTimestamp
      };
    });
  }

  return [];
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch only execution_logs field for performance
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('id, execution_logs')
      .eq('id', executionIdNum)
      .single();

    if (error || !execution) {
      return NextResponse.json(
        {
          success: false,
          error: `Execution ${executionIdNum} not found`,
        },
        { status: 404 }
      );
    }

    // Transform logs to expected format
    const transformedLogs = transformExecutionLogs((execution as any).execution_logs);

    return NextResponse.json({
      success: true,
      logs: transformedLogs,
      count: transformedLogs.length,
    });
  } catch (error) {
    console.error('[ERROR] Error fetching execution logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve execution logs',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
