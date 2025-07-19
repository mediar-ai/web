import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const offset = (page - 1) * limit;
    
    // Query filters
    const userId = searchParams.get('user_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const minEvents = searchParams.get('min_events');
    const application = searchParams.get('application');
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get session aggregations with event counts
    let query = supabase
      .from('events')
      .select(`
        session_id,
        user_id,
        created_at,
        payload
      `)
      .order('created_at', { ascending: false });

    // Apply basic filters to events query
    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    if (application) {
      query = query.ilike('payload->event->screen->>application_name', `%${application}%`);
    }

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      const errorResponse = {
        success: false,
        error: `Failed to fetch session data: ${eventsError.message}`,
        timestamp: new Date().toISOString()
      };

      await cacheResponse({
        endpointPath: '/api/workflow-recorder/sessions',
        httpMethod: 'GET',
        statusCode: 500,
        responseBody: errorResponse,
        requestParams: Object.fromEntries(searchParams),
        executionTimeMs: 50
      });

      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Group events by session and aggregate data
    const sessionMap = new Map();
    
    events?.forEach(event => {
      const sessionId = event.session_id;
      const existing = sessionMap.get(sessionId);
      
      const eventData = {
        timestamp: event.created_at,
        type: event.payload?.type,
        application: event.payload?.event?.screen?.application_name,
        client_info: event.payload?.client_identity
      };
      
      if (existing) {
        existing.event_count++;
        existing.events.push(eventData);
        existing.end_time = event.created_at;
        existing.applications.add(eventData.application);
        existing.event_types.add(eventData.type);
      } else {
        sessionMap.set(sessionId, {
          session_id: sessionId,
          user_id: event.user_id,
          start_time: event.created_at,
          end_time: event.created_at,
          event_count: 1,
          applications: new Set([eventData.application]),
          event_types: new Set([eventData.type]),
          events: [eventData],
          client_info: eventData.client_info
        });
      }
    });

    // Convert to array and calculate session durations
    let sessions = Array.from(sessionMap.values()).map(session => {
      const startTime = new Date(session.start_time);
      const endTime = new Date(session.end_time);
      const durationMs = endTime.getTime() - startTime.getTime();
      
      return {
        session_id: session.session_id,
        user_id: session.user_id,
        start_time: session.start_time,
        end_time: session.end_time,
        duration_minutes: Math.round(durationMs / (1000 * 60) * 10) / 10,
        event_count: session.event_count,
        applications: Array.from(session.applications).filter(Boolean),
        event_types: Array.from(session.event_types).filter(Boolean),
        client_info: {
          hostname: session.client_info?.hostname,
          username: session.client_info?.username,
          os_info: session.client_info?.os_info,
          app_version: session.client_info?.app_version,
          location: session.client_info?.ip_location ? 
            `${session.client_info.ip_location.city}, ${session.client_info.ip_location.country}` : null
        },
        endpoints: {
          events: `/api/workflow-recorder?session_id=${session.session_id}`,
          timeline: `/api/workflow-recorder?session_id=${session.session_id}&start_date=${session.start_time}&end_date=${session.end_time}`
        }
      };
    });

    // Apply session-level filters
    if (minEvents) {
      const minEventsNum = parseInt(minEvents);
      sessions = sessions.filter(session => session.event_count >= minEventsNum);
    }

    // Sort by start time (most recent first)
    sessions.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    // Apply pagination
    const totalSessions = sessions.length;
    const paginatedSessions = sessions.slice(offset, offset + limit);

    const responseData = {
      success: true,
      sessions: paginatedSessions,
      pagination: {
        page,
        limit,
        total: totalSessions,
        total_pages: Math.ceil(totalSessions / limit),
        has_next: offset + limit < totalSessions,
        has_previous: page > 1
      },
      filters_applied: {
        user_id: userId,
        start_date: startDate,
        end_date: endDate,
        min_events: minEvents,
        application: application
      },
      summary: {
        total_sessions: totalSessions,
        total_events: sessions.reduce((sum, s) => sum + s.event_count, 0),
        avg_events_per_session: totalSessions > 0 ? 
          Math.round(sessions.reduce((sum, s) => sum + s.event_count, 0) / totalSessions * 10) / 10 : 0,
        avg_session_duration_minutes: totalSessions > 0 ?
          Math.round(sessions.reduce((sum, s) => sum + s.duration_minutes, 0) / totalSessions * 10) / 10 : 0,
        unique_applications: [...new Set(sessions.flatMap(s => s.applications))],
        unique_users: [...new Set(sessions.map(s => s.user_id))]
      },
      meta: {
        endpoint: '/api/workflow-recorder/sessions',
        description: 'Query workflow recorder sessions with aggregated metrics',
        use_cases: [
          'Analyze user workflow patterns',
          'Find long recording sessions',
          'Identify most active applications',
          'Track user engagement over time'
        ]
      },
      timestamp: new Date().toISOString()
    };

    // Cache successful response for documentation
    await cacheResponse({
      endpointPath: '/api/workflow-recorder/sessions',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: Object.fromEntries(searchParams),
      executionTimeMs: 200
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Workflow recorder sessions API error:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}