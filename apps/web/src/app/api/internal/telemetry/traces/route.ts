import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Fetch telemetry traces from Supabase
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({
        success: false,
        error: 'Supabase not configured',
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const traceId = searchParams.get('traceId');

    if (traceId) {
      // Get specific trace
      const { data: spans, error } = await supabase
        .from('telemetry_traces')
        .select('*')
        .eq('trace_id', traceId)
        .order('start_time', { ascending: true });

      if (error) throw error;

      return NextResponse.json({
        success: true,
        traces: [{
          traceId,
          spans,
          spanCount: spans?.length || 0,
          rootSpan: spans?.find((s: any) => !s.parent_span_id),
          startTime: spans?.[0]?.start_time,
          duration: spans?.reduce((sum: number, s: any) => sum + (s.duration_ms || 0), 0),
        }],
      });
    }

    // Get trace summaries
    const { data: traceSummaries, error: summaryError } = await supabase
      .from('telemetry_trace_summaries')
      .select('*')
      .order('trace_start', { ascending: false })
      .limit(limit);

    if (summaryError) throw summaryError;

    // Transform to match dashboard format
    const traces = (traceSummaries || []).map((summary: any) => ({
      traceId: summary.trace_id,
      spans: [], // Will be loaded on demand
      spanCount: summary.span_count,
      rootSpan: {
        name: summary.root_span_name,
        attributes: summary.root_attributes,
      },
      startTime: summary.trace_start,
      duration: summary.total_duration_ms,
      status: summary.max_status_code,
      machineIds: summary.machine_ids,
    }));

    // For the most recent traces, load their spans
    const recentTraceIds = traces.slice(0, 5).map((t: any) => t.traceId);
    if (recentTraceIds.length > 0) {
      const { data: recentSpans } = await supabase
        .from('telemetry_traces')
        .select('*')
        .in('trace_id', recentTraceIds)
        .order('start_time', { ascending: true });

      // Group spans by trace
      const spansByTrace = (recentSpans || []).reduce((acc: any, span: any) => {
        if (!acc[span.trace_id]) acc[span.trace_id] = [];
        acc[span.trace_id].push(span);
        return acc;
      }, {});

      // Add spans to traces
      traces.forEach((trace: any) => {
        if (spansByTrace[trace.traceId]) {
          trace.spans = spansByTrace[trace.traceId];
        }
      });
    }

    return NextResponse.json({
      success: true,
      traces,
      totalCount: traceSummaries?.length || 0,
    });
  } catch (error) {
    console.error('Failed to fetch telemetry traces:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Fetch telemetry metrics from Supabase
export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({
        success: false,
        error: 'Supabase not configured',
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { machineId, metricName, timeRange = '1h' } = await request.json();

    // Calculate time window
    const timeWindows: Record<string, string> = {
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    };
    
    const since = new Date();
    const [amount, unit] = (timeWindows[timeRange] || '1 hour').split(' ');
    since.setHours(since.getHours() - (unit === 'days' ? parseInt(amount) * 24 : parseInt(amount)));

    // Build query
    let query = supabase
      .from('telemetry_metrics')
      .select('*')
      .gte('timestamp', since.toISOString())
      .order('timestamp', { ascending: false });

    if (machineId) {
      query = query.eq('machine_id', machineId);
    }
    
    if (metricName) {
      query = query.eq('metric_name', metricName);
    }

    const { data: metrics, error } = await query.limit(1000);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      metrics,
      count: metrics?.length || 0,
      timeRange,
      since: since.toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch telemetry metrics:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}