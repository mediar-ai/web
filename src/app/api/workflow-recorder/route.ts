import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = (page - 1) * limit;
    
    // Query filters
    const userId = searchParams.get('user_id');
    const sessionId = searchParams.get('session_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const eventType = searchParams.get('event_type');
    const application = searchParams.get('application');
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Build the base query
    let query = supabase
      .from('low_level_events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    if (eventType) {
      query = query.eq('payload->type', eventType);
    }
    if (application) {
      query = query.ilike('payload->event->screen->>application_name', `%${application}%`);
    }

    const { data: events, error: eventsError, count } = await query;

    if (eventsError) {
      const errorResponse = {
        success: false,
        error: `Failed to fetch workflow recorder events: ${eventsError.message}`,
        timestamp: new Date().toISOString()
      };

      await cacheResponse({
        endpointPath: '/api/workflow-recorder',
        httpMethod: 'GET',
        statusCode: 500,
        responseBody: errorResponse,
        requestParams: Object.fromEntries(searchParams),
        executionTimeMs: 50
      });

      return NextResponse.json(errorResponse, { status: 500 });
    }

    // Process events to extract useful metadata
    const processedEvents = events?.map(event => ({
      id: event.id,
      user_id: event.user_id,
      session_id: event.session_id,
      timestamp: event.created_at,
      event_type: event.payload?.type,
      application_name: event.payload?.event?.screen?.application_name,
      process_id: event.payload?.event?.screen?.process_id,
      ui_tree_size: event.payload?.event?.screen?.ui_tree ? 
        JSON.stringify(event.payload.event.screen.ui_tree).length : 0,
      client_info: {
        hostname: event.payload?.client_identity?.hostname,
        username: event.payload?.client_identity?.username,
        os_info: event.payload?.client_identity?.os_info,
        app_version: event.payload?.client_identity?.app_version,
        location: event.payload?.client_identity?.ip_location?.city + ', ' + 
                 event.payload?.client_identity?.ip_location?.country
      }
    })) || [];

    const responseData = {
      success: true,
      events: processedEvents,
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
        has_next: offset + limit < (count || 0),
        has_previous: page > 1
      },
      filters_applied: {
        user_id: userId,
        session_id: sessionId,
        start_date: startDate,
        end_date: endDate,
        event_type: eventType,
        application: application
      },
      meta: {
        endpoint: '/api/workflow-recorder',
        description: 'Query workflow recorder events and UI tree data',
        data_types: {
          ui_tree: 'Complete UI tree capture data',
          screen_capture: 'Screen and application context',
          interaction: 'User interaction events',
          navigation: 'Browser/application navigation',
          typing: 'Text input events'
        }
      },
      timestamp: new Date().toISOString()
    };

    // Cache successful response for documentation
    await cacheResponse({
      endpointPath: '/api/workflow-recorder',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: Object.fromEntries(searchParams),
      executionTimeMs: 150
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Workflow recorder API error:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}