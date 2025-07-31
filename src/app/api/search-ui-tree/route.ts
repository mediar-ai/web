import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper function to extract clean values from UI tree JSON and find keyword matches
function extractCleanValues(uiTreeString: string, keyword?: string) {
  try {
    const uiTree = JSON.parse(uiTreeString);
    
    const cleanValues = {
      textContent: [] as string[],
      formFields: [] as string[],
      buttons: [] as string[],
      links: [] as string[],
      allValues: [] as string[],
      keywordMatches: [] as Array<{
        text: string;
        type: string;
        context: string;
      }>
    };
    
    function traverse(node: any, depth = 0) {
      if (!node || typeof node !== 'object') return;
      
      const attrs = node.attributes || {};
      const role = attrs.role;
      const name = attrs.name;
      
      // Function to check if text contains keyword and create match
      const checkForKeyword = (text: string, type: string) => {
        if (keyword && text.toLowerCase().includes(keyword.toLowerCase())) {
          // Get some context around the match
          const index = text.toLowerCase().indexOf(keyword.toLowerCase());
          const start = Math.max(0, index - 20);
          const end = Math.min(text.length, index + keyword.length + 20);
          const context = text.substring(start, end);
          
          cleanValues.keywordMatches.push({
            text: text,
            type: type,
            context: context
          });
        }
      };
      
      // Categorize by role
      if (name && typeof name === 'string' && name.trim()) {
        const cleanName = name.trim();
        cleanValues.allValues.push(cleanName);
        
        switch (role) {
          case 'Text':
            cleanValues.textContent.push(cleanName);
            checkForKeyword(cleanName, 'Text');
            break;
          case 'Button':
            cleanValues.buttons.push(cleanName);
            checkForKeyword(cleanName, 'Button');
            break;
          case 'Edit':
          case 'ComboBox':
            cleanValues.formFields.push(cleanName);
            checkForKeyword(cleanName, 'Form Field');
            break;
          case 'Hyperlink':
            cleanValues.links.push(cleanName);
            checkForKeyword(cleanName, 'Link');
            break;
          default:
            // Check other elements too
            checkForKeyword(cleanName, role || 'UI Element');
            break;
        }
      }
      
      // Also extract other meaningful attributes
      if (attrs.value && typeof attrs.value === 'string' && attrs.value.trim()) {
        const value = attrs.value.trim();
        cleanValues.allValues.push(value);
        checkForKeyword(value, 'Value');
      }
      
      // Check other text attributes
      ['title', 'description', 'help'].forEach(attr => {
        if (attrs[attr] && typeof attrs[attr] === 'string' && attrs[attr].trim()) {
          const text = attrs[attr].trim();
          checkForKeyword(text, attr);
        }
      });
      
      // Recursively process children
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any) => traverse(child, depth + 1));
      }
    }
    
    traverse(uiTree);
    
    return cleanValues;
  } catch (error) {
    console.error('Error parsing UI tree:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const keyword = searchParams.get('keyword');
    const format = searchParams.get('format') || 'structured'; // 'structured' or 'flat'
    
    // New pagination and filtering parameters
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100); // Max 100 results
    const offset = parseInt(searchParams.get('offset') || '0');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const appName = searchParams.get('appName');
    const sortBy = searchParams.get('sortBy') || 'created_at'; // 'created_at' or 'relevance'
    const sortOrder = searchParams.get('sortOrder') || 'desc'; // 'asc' or 'desc'
    
    console.log(`🔍 UI Tree Search Request - User: ${userId}, Keyword: "${keyword}", Format: ${format}, Limit: ${limit}, Offset: ${offset}`);
    
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    
    if (!keyword) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 });
    }
    
    // Search for UI tree events containing the keyword using PostgreSQL text search
    // Based on our debug findings, use the nested payload structure that actually exists
    const searchPattern = `%${keyword}%`;
    
    // Build query with new filtering and pagination
    let query = supabaseAdmin
      .from('low_level_events_enriched')
      .select('id, created_at, payload, app_name', { count: 'exact' })
      .eq('user_id', userId)
      .eq('event_type', 'ui_tree')
      .ilike('payload->payload->event->screen->>ui_tree', searchPattern);
    
    // Add optional filters
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    if (appName) {
      query = query.eq('app_name', appName);
    }
    
    // Add sorting
    const ascending = sortOrder === 'asc';
    if (sortBy === 'created_at') {
      query = query.order('created_at', { ascending });
    }
    // Note: 'relevance' sorting would require more complex implementation with text search ranking
    
    // Add pagination
    const { data: events, error, count } = await query
      .range(offset, offset + limit - 1);
    
    if (error) {
      console.error('Database search error:', error);
      return NextResponse.json({ 
        error: 'Failed to search UI tree events', 
        details: error.message 
      }, { status: 500 });
    }
    
    if (!events || events.length === 0) {
      return NextResponse.json({ 
        message: `No UI tree events found containing keyword: "${keyword}"`,
        found: false,
        keyword: keyword,
        userId: userId,
        pagination: {
          total: count || 0,
          limit: limit,
          offset: offset,
          hasMore: false
        }
      });
    }
    
    console.log(`[SUCCESS] Found ${events.length} matching events (total: ${count || 0})`);
    
    // Process multiple events
    const results = [];
    let totalValuesExtracted = 0;
    
    for (const event of events) {
      // Extract UI tree string from payload
      const payload = event.payload as any;
      let uiTreeString: string | null = null;
      
      // Try different payload structures
      if (payload?.payload?.event?.screen?.ui_tree) {
        uiTreeString = payload.payload.event.screen.ui_tree;
      } else if (payload?.event?.screen?.ui_tree) {
        uiTreeString = payload.event.screen.ui_tree;
      }
      
      if (!uiTreeString) {
        continue; // Skip events without UI tree data
      }
      
      // Extract clean values and find keyword matches
      const cleanValues = extractCleanValues(uiTreeString, keyword);
      
      if (!cleanValues) {
        continue; // Skip events that can't be parsed
      }
      
      totalValuesExtracted += cleanValues.allValues.length;
      
      // Prepare result based on format
      if (format === 'flat') {
        results.push({
          eventId: event.id,
          timestamp: event.created_at,
          appName: event.app_name,
          values: cleanValues.allValues
        });
      } else {
        results.push({
          eventId: event.id,
          timestamp: event.created_at,
          appName: event.app_name,
          keywordMatches: cleanValues.keywordMatches,
          cleanValues: {
            textContent: cleanValues.textContent,
            formFields: cleanValues.formFields,
            buttons: cleanValues.buttons,
            links: cleanValues.links,
            totalValues: cleanValues.allValues.length
          },
          summary: {
            totalTextElements: cleanValues.textContent.length,
            totalFormFields: cleanValues.formFields.length,
            totalButtons: cleanValues.buttons.length,
            totalLinks: cleanValues.links.length,
            totalUniqueValues: new Set(cleanValues.allValues).size,
            keywordMatchesCount: cleanValues.keywordMatches.length
          }
        });
      }
    }
    
    // Prepare final response
    const responseData = {
      found: true,
      keyword: keyword,
      userId: userId,
      results: results,
      pagination: {
        total: count || 0,
        limit: limit,
        offset: offset,
        hasMore: (offset + limit) < (count || 0),
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil((count || 0) / limit)
      },
      meta: {
        processingTime: Date.now() - startTime,
        totalValuesExtracted: totalValuesExtracted,
        resultsReturned: results.length,
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          appName: appName || null,
          sortBy: sortBy,
          sortOrder: sortOrder
        }
      }
    };
    
    console.log(`[STATS] Processed ${results.length} events, extracted ${totalValuesExtracted} total values`);
    return NextResponse.json(responseData);
    
  } catch (err) {
    const error = err as { message: string };
    console.error('[API/search-ui-tree] Critical error:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error.message 
    }, { status: 500 });
  }
} 