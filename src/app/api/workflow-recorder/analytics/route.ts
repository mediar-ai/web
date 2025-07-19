import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Query filters for time range
    const timeRange = searchParams.get('time_range') || '7d'; // 1d, 7d, 30d, 90d
    const userId = searchParams.get('user_id');
    const application = searchParams.get('application');
    
    // Calculate date range
    const now = new Date();
    const timeRangeMap: { [key: string]: number } = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90
    };
    
    const daysBack = timeRangeMap[timeRange] || 7;
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Build the base query
    let query = supabase
      .from('low_level_events')
      .select('*')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    // Apply filters
    if (userId) {
      query = query.eq('user_id', userId);
    }
    if (application) {
      query = query.ilike('payload->event->screen->>application_name', `%${application}%`);
    }

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      const errorResponse = {
        success: false,
        error: `Failed to fetch analytics data: ${eventsError.message}`,
        timestamp: new Date().toISOString()
      };

      await cacheResponse({
        endpointPath: '/api/workflow-recorder/analytics',
        httpMethod: 'GET',
        statusCode: 500,
        responseBody: errorResponse,
        requestParams: Object.fromEntries(searchParams),
        executionTimeMs: 50
      });

      return NextResponse.json(errorResponse, { status: 500 });
    }

    interface UserData {
      events: number;
      sessions: Set<string>;
      applications: Set<string>;
    }

    // Process events for analytics
    const analytics = {
      overview: {
        total_events: events?.length || 0,
        unique_sessions: new Set(events?.map(e => e.session_id)).size,
        unique_users: new Set(events?.map(e => e.user_id)).size,
        date_range: {
          start: startDate,
          end: now.toISOString(),
          days: daysBack
        }
      },
      
      event_types: {} as Record<string, number>,
      applications: {} as Record<string, number>,
      users: {} as Record<string, UserData>,
      
      timeline: [] as { date: string, events: number, sessions: number, users: number }[],
      
      ui_complexity: {
        avg_elements_per_tree: 0,
        max_elements_in_tree: 0,
        interactive_element_ratio: 0,
        total_ui_trees: 0
      },
      
      session_patterns: {
        avg_events_per_session: 0,
        avg_session_duration_minutes: 0,
        sessions_by_duration: {
          '0-5min': 0,
          '5-15min': 0,
          '15-60min': 0,
          '60min+': 0
        }
      }
    };

    // Group events by session for session analysis
    const sessionMap = new Map();
    let totalUIElements = 0;
    let maxUIElements = 0;
    let totalInteractiveElements = 0;
    let uiTreeCount = 0;

    events?.forEach(event => {
      // Event type analysis
      const eventType = event.payload?.type || 'unknown';
      analytics.event_types[eventType] = (analytics.event_types[eventType] || 0) + 1;

      // Application analysis
      const app = event.payload?.event?.screen?.application_name || 'unknown';
      analytics.applications[app] = (analytics.applications[app] || 0) + 1;

      // User analysis
      const userId = event.user_id;
      if (!analytics.users[userId]) {
        analytics.users[userId] = {
          events: 0,
          sessions: new Set(),
          applications: new Set()
        };
      }
      analytics.users[userId].events++;
      analytics.users[userId].sessions.add(event.session_id);
      analytics.users[userId].applications.add(app);

      // Session tracking
      const sessionId = event.session_id;
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, {
          user_id: userId,
          start_time: event.created_at,
          end_time: event.created_at,
          events: 1
        });
      } else {
        const session = sessionMap.get(sessionId);
        session.end_time = event.created_at;
        session.events++;
      }

      // UI complexity analysis
      if (event.payload?.event?.screen?.ui_tree) {
        try {
          const uiTree = typeof event.payload.event.screen.ui_tree === 'string' 
            ? JSON.parse(event.payload.event.screen.ui_tree)
            : event.payload.event.screen.ui_tree;
          
          interface UINode {
            attributes?: {
              is_keyboard_focusable?: boolean;
              role?: string;
            };
            children?: UINode[];
          }

          const countElements = (node: UINode): { total: number, interactive: number } => {
            if (!node) return { total: 0, interactive: 0 };
            
            let total = 1;
            let interactive = 0;
            
            if (node.attributes) {
              const isInteractive = !!(
                node.attributes.is_keyboard_focusable ||
                node.attributes.role === 'Button' ||
                node.attributes.role === 'Edit' ||
                node.attributes.role === 'ComboBox'
              );
              if (isInteractive) interactive = 1;
            }
            
            if (node.children) {
              node.children.forEach((child: UINode) => {
                const childCounts = countElements(child);
                total += childCounts.total;
                interactive += childCounts.interactive;
              });
            }
            
            return { total, interactive };
          };
          
          const counts = countElements(uiTree);
          totalUIElements += counts.total;
          totalInteractiveElements += counts.interactive;
          maxUIElements = Math.max(maxUIElements, counts.total);
          uiTreeCount++;
        } catch {
          // Skip malformed UI trees
        }
      }
    });

    // Calculate UI complexity metrics
    analytics.ui_complexity = {
      avg_elements_per_tree: uiTreeCount > 0 ? Math.round(totalUIElements / uiTreeCount) : 0,
      max_elements_in_tree: maxUIElements,
      interactive_element_ratio: totalUIElements > 0 ? 
        Math.round((totalInteractiveElements / totalUIElements) * 100) / 100 : 0,
      total_ui_trees: uiTreeCount
    };

    // Calculate session patterns
    const sessions = Array.from(sessionMap.values());
    if (sessions.length > 0) {
      const avgEvents = sessions.reduce((sum, s) => sum + s.events, 0) / sessions.length;
      analytics.session_patterns.avg_events_per_session = Math.round(avgEvents * 10) / 10;

      // Calculate session durations
      const durations = sessions.map(session => {
        const start = new Date(session.start_time);
        const end = new Date(session.end_time);
        return (end.getTime() - start.getTime()) / (1000 * 60); // minutes
      });

      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      analytics.session_patterns.avg_session_duration_minutes = Math.round(avgDuration * 10) / 10;

      // Categorize sessions by duration
      durations.forEach(duration => {
        if (duration <= 5) {
          analytics.session_patterns.sessions_by_duration['0-5min']++;
        } else if (duration <= 15) {
          analytics.session_patterns.sessions_by_duration['5-15min']++;
        } else if (duration <= 60) {
          analytics.session_patterns.sessions_by_duration['15-60min']++;
        } else {
          analytics.session_patterns.sessions_by_duration['60min+']++;
        }
      });
    }

    // Create timeline data (daily aggregation)
    const timelineMap = new Map();
    events?.forEach(event => {
      const date = event.created_at.split('T')[0]; // Get YYYY-MM-DD
      if (!timelineMap.has(date)) {
        timelineMap.set(date, {
          date,
          events: 0,
          sessions: new Set(),
          users: new Set()
        });
      }
      const dayData = timelineMap.get(date);
      dayData.events++;
      dayData.sessions.add(event.session_id);
      dayData.users.add(event.user_id);
    });

    analytics.timeline = Array.from(timelineMap.values())
      .map(day => ({
        date: day.date,
        events: day.events,
        sessions: day.sessions.size,
        users: day.users.size
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Convert user data to serializable format
    const processedUsers: Record<string, { events: number, sessions: number, applications: number }> = {};
    Object.entries(analytics.users).forEach(([userId, userData]) => {
      processedUsers[userId] = {
        events: userData.events,
        sessions: userData.sessions.size,
        applications: userData.applications.size
      };
    });

    const responseData = {
      success: true,
      analytics: {
        ...analytics,
        users: processedUsers
      },
      insights: {
        most_active_user: Object.entries(processedUsers)
          .sort(([,a], [,b]) => b.events - a.events)[0]?.[0] || null,
        most_used_application: Object.entries(analytics.applications)
          .sort(([,a], [,b]) => b - a)[0]?.[0] || null,
        peak_activity_day: analytics.timeline
          .sort((a, b) => b.events - a.events)[0]?.date || null,
        complexity_trend: uiTreeCount > 10 ? 'sufficient_data' : 'need_more_data'
      },
      meta: {
        endpoint: '/api/workflow-recorder/analytics',
        description: 'Aggregated analytics and insights from workflow recorder data',
        time_range_applied: timeRange,
        filters_applied: {
          user_id: userId,
          application: application
        }
      },
      timestamp: new Date().toISOString()
    };

    // Cache successful response for documentation
    await cacheResponse({
      endpointPath: '/api/workflow-recorder/analytics',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: Object.fromEntries(searchParams),
      executionTimeMs: 300
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Workflow recorder analytics API error:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}