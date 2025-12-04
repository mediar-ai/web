import { NextRequest, NextResponse } from 'next/server';

// OpenTelemetry OTLP/HTTP trace receiver endpoint
// This receives trace data from the Rust MCP agents

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string; boolValue?: boolean };
  }>;
  status?: {
    code: number;
    message?: string;
  };
  events?: Array<{
    timeUnixNano: string;
    name: string;
    attributes?: Array<{
      key: string;
      value: { stringValue?: string; intValue?: string };
    }>;
  }>;
}

interface OTLPTraceRequest {
  resourceSpans: Array<{
    resource?: {
      attributes?: Array<{
        key: string;
        value: { stringValue?: string };
      }>;
    };
    scopeSpans: Array<{
      scope?: {
        name: string;
        version?: string;
      };
      spans: OTLPSpan[];
    }>;
  }>;
}

// In-memory storage for traces (in production, use a database)
const traceStore = new Map<string, any[]>();
const MAX_TRACES = 1000;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type');
    
    let traceData: OTLPTraceRequest;
    
    // Handle both JSON and protobuf formats
    if (contentType?.includes('application/json')) {
      traceData = await request.json();
    } else if (contentType?.includes('application/x-protobuf')) {
      // For protobuf, we'd need to decode it - for now just accept JSON
      return NextResponse.json(
        { error: 'Protobuf not yet supported, please use JSON' },
        { status: 415 }
      );
    } else {
      return NextResponse.json(
        { error: 'Unsupported content type' },
        { status: 415 }
      );
    }

    // Process and store the traces
    const processedTraces: any[] = [];
    
    for (const resourceSpan of traceData.resourceSpans) {
      const resource = resourceSpan.resource?.attributes?.reduce((acc, attr) => {
        acc[attr.key] = attr.value.stringValue || '';
        return acc;
      }, {} as Record<string, string>);

      for (const scopeSpan of resourceSpan.scopeSpans) {
        for (const span of scopeSpan.spans) {
          const attributes = span.attributes?.reduce((acc, attr) => {
            const value = attr.value.stringValue || attr.value.intValue || attr.value.boolValue;
            acc[attr.key] = value;
            return acc;
          }, {} as Record<string, any>);

          const events = span.events?.map(event => ({
            timestamp: new Date(parseInt(event.timeUnixNano) / 1_000_000).toISOString(),
            name: event.name,
            attributes: event.attributes?.reduce((acc, attr) => {
              acc[attr.key] = attr.value.stringValue || attr.value.intValue;
              return acc;
            }, {} as Record<string, any>),
          }));

          const processedSpan = {
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: span.kind,
            startTime: new Date(parseInt(span.startTimeUnixNano) / 1_000_000).toISOString(),
            endTime: span.endTimeUnixNano ? new Date(parseInt(span.endTimeUnixNano) / 1_000_000).toISOString() : null,
            duration: span.endTimeUnixNano ? 
              (parseInt(span.endTimeUnixNano) - parseInt(span.startTimeUnixNano)) / 1_000_000 : null,
            attributes,
            events,
            status: span.status,
            resource,
            scope: scopeSpan.scope?.name,
            timestamp: new Date().toISOString(),
          };

          processedTraces.push(processedSpan);
          
          // Store by traceId for retrieval
          if (!traceStore.has(span.traceId)) {
            traceStore.set(span.traceId, []);
          }
          traceStore.get(span.traceId)!.push(processedSpan);
        }
      }
    }

    // Cleanup old traces if we exceed the limit
    if (traceStore.size > MAX_TRACES) {
      const oldestTraces = Array.from(traceStore.keys()).slice(0, traceStore.size - MAX_TRACES);
      oldestTraces.forEach(traceId => traceStore.delete(traceId));
    }

    // Log for debugging
    console.log(`Received ${processedTraces.length} spans from OTLP`);
    
    // Store in Supabase if configured (optional)
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        // Store workflow spans
        const workflowSpans = processedTraces.filter(span => 
          span.name.includes('workflow') || span.attributes?.['workflow.name']
        );
        
        if (workflowSpans.length > 0) {
          await supabase.from('telemetry_traces').insert(
            workflowSpans.map(span => ({
              trace_id: span.traceId,
              span_id: span.spanId,
              parent_span_id: span.parentSpanId,
              name: span.name,
              start_time: span.startTime,
              end_time: span.endTime,
              duration_ms: span.duration,
              attributes: span.attributes,
              events: span.events,
              status: span.status,
              resource: span.resource,
            }))
          );
        }
      } catch (error) {
        console.error('Failed to store traces in Supabase:', error);
      }
    }

    // Return success response (OTLP expects an empty response)
    return NextResponse.json({}, { status: 200 });
  } catch (error) {
    console.error('OTLP receiver error:', error);
    return NextResponse.json(
      { error: 'Failed to process trace data' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve stored traces
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const traceId = searchParams.get('traceId');
  const limit = parseInt(searchParams.get('limit') || '100');
  
  if (traceId) {
    const traces = traceStore.get(traceId) || [];
    return NextResponse.json({ traces });
  }
  
  // Return recent traces
  const allTraces: any[] = [];
  let count = 0;
  
  // Get most recent traces
  const traceIds = Array.from(traceStore.keys()).reverse();
  for (const id of traceIds) {
    if (count >= limit) break;
    const traces = traceStore.get(id) || [];
    allTraces.push({
      traceId: id,
      spans: traces,
      rootSpan: traces.find(s => !s.parentSpanId),
      spanCount: traces.length,
      startTime: traces[0]?.startTime,
      duration: traces[0]?.duration,
    });
    count++;
  }
  
  return NextResponse.json({
    traces: allTraces,
    totalTraces: traceStore.size,
  });
}