import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const { searchParams } = new URL(request.url);
    const includeRawData = searchParams.get('include_raw') === 'true';
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      const errorResponse = {
        success: false,
        error: `Event ${eventId} not found`,
        timestamp: new Date().toISOString()
      };

      await cacheResponse({
        endpointPath: '/api/workflow-recorder/[eventId]',
        httpMethod: 'GET',
        statusCode: 404,
        responseBody: errorResponse,
        requestParams: { eventId, include_raw: includeRawData },
        executionTimeMs: 25
      });

      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Extract UI tree elements for easier analysis
    interface UIElement {
      id: string;
      path: string;
      role: string;
      name: string;
      bounds?: number[];
      properties: Record<string, unknown>;
      is_interactive: boolean;
    }

    interface UINode {
      id?: string;
      attributes?: {
        role?: string;
        name?: string;
        bounds?: number[];
        properties?: Record<string, unknown>;
        is_keyboard_focusable?: boolean;
      };
      children?: UINode[];
    }

    const extractUIElements = (uiTree: UINode): UIElement[] => {
      if (!uiTree) return [];
      
      const elements: UIElement[] = [];
      
      const traverse = (node: UINode, path: string = '') => {
        if (node.attributes) {
          elements.push({
            id: node.id || '',
            path,
            role: node.attributes.role || '',
            name: node.attributes.name || '',
            bounds: node.attributes.bounds,
            properties: node.attributes.properties || {},
            is_interactive: !!(
              node.attributes.is_keyboard_focusable ||
              node.attributes.role === 'Button' ||
              node.attributes.role === 'Edit' ||
              node.attributes.role === 'ComboBox'
            )
          });
        }
        
        if (node.children) {
          node.children.forEach((child: UINode, index: number) => {
            traverse(child, `${path}/${index}`);
          });
        }
      };
      
      traverse(uiTree);
      return elements;
    };

    // Parse UI tree if available
    let uiTreeData: UINode | null = null;
    let uiElements: UIElement[] = [];
    
    if (event.payload?.event?.screen?.ui_tree) {
      try {
        uiTreeData = typeof event.payload.event.screen.ui_tree === 'string' 
          ? JSON.parse(event.payload.event.screen.ui_tree) as UINode
          : event.payload.event.screen.ui_tree as UINode;
        
        uiElements = extractUIElements(uiTreeData);
      } catch (error) {
        console.error('Failed to parse UI tree:', error);
      }
    }

    // Build comprehensive event details
    const eventDetails = {
      id: event.id,
      user_id: event.user_id,
      session_id: event.session_id,
      timestamp: event.created_at,
      
      // Event metadata
      event_metadata: {
        type: event.payload?.type,
        timestamp: event.payload?.timestamp,
        application_name: event.payload?.event?.screen?.application_name,
        process_id: event.payload?.event?.screen?.process_id,
      },
      
      // Client context
      client_context: {
        identity: event.payload?.client_identity || {},
        location: event.payload?.client_identity?.ip_location || {}
      },
      
      // UI analysis
      ui_analysis: {
        total_elements: uiElements.length,
        interactive_elements: uiElements.filter(el => el.is_interactive).length,
        element_types: uiElements.reduce((acc: Record<string, number>, element) => {
          acc[element.role] = (acc[element.role] || 0) + 1;
          return acc;
        }, {}),
        applications: [...new Set([event.payload?.event?.screen?.application_name].filter(Boolean))],
        ui_tree_size_bytes: JSON.stringify(uiTreeData || {}).length
      },
      
      // Interactive elements for workflow development
      interactive_elements: uiElements
        .filter(el => el.is_interactive)
        .slice(0, 20) // Limit to first 20 for performance
        .map(el => ({
          id: el.id,
          role: el.role,
          name: el.name,
          bounds: el.bounds,
          selector_hints: {
            by_id: `#${el.id}`,
            by_role_name: el.name ? `role:${el.role}|name:${el.name}` : `role:${el.role}`,
            by_properties: Object.keys(el.properties).length > 0 ? el.properties : null
          }
        })),
      
      // Related events (same session within 5 minutes)
      related_events_hint: {
        query_suggestion: `/api/workflow-recorder?session_id=${event.session_id}&start_date=${new Date(Date.parse(event.created_at) - 5*60*1000).toISOString()}&end_date=${new Date(Date.parse(event.created_at) + 5*60*1000).toISOString()}`,
        description: 'Query to find related events in the same session'
      }
    };

          // Include raw data if requested
      if (includeRawData) {
        (eventDetails as typeof eventDetails & { raw_data: unknown }).raw_data = {
          full_event: event,
          ui_tree: uiTreeData,
          all_ui_elements: uiElements
        };
      }

    const responseData = {
      success: true,
      event: eventDetails,
      timestamp: new Date().toISOString()
    };

    // Cache successful response for documentation
    await cacheResponse({
      endpointPath: '/api/workflow-recorder/[eventId]',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: { eventId, include_raw: includeRawData },
      executionTimeMs: 100
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Workflow recorder event API error:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}