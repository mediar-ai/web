import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type JSONValue = string | number | boolean | { [x: string]: JSONValue } | Array<JSONValue>;
type JSONObject = { [x: string]: JSONValue };

// Helper to recursively transform variables into a UI-friendly schema
const transformVariablesToSchema = (variables: JSONObject): JSONObject => {
  const schema: JSONObject = {};
  for (const key in variables) {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const variable = { ...(variables[key] as JSONObject) };

      // Convert "enum" to "select" for the UI component
      if (variable.type === 'enum' && Array.isArray(variable.options)) {
        variable.type = 'select';
        // Format options for the Select component
        variable.options = (variable.options as string[]).map(opt => ({ value: opt, label: opt }));
      }
      
      schema[key] = variable;
    }
  }
  return schema;
};

// Helper to recursively extract default values from a schema object
const extractDefaults = (schema: JSONObject): JSONObject => {
  const defaults: JSONObject = {};
  for (const key in schema) {
    const value = schema[key] as JSONObject;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.hasOwnProperty('default')) {
        defaults[key] = value.default;
      } else {
        // This is a nested group of parameters, not a parameter itself.
        const nestedDefaults = extractDefaults(value);
        if (Object.keys(nestedDefaults).length > 0) {
          defaults[key] = nestedDefaults;
        }
      }
    }
  }
  return defaults;
};

export async function GET(request: NextRequest) {
  try {
    console.log('⚡ Fast workflow list from Vercel...');
    
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query with filters
    let query = supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        description,
        version,
        status,
        category,
        tags,
        difficulty_level,
        estimated_duration_seconds,
        successful_runs,
        failed_runs,
        total_executions,
        deployment_status,
        automation_sequence,
        created_at,
        updated_at
      `)
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq('category', category);
    }

    const { data: workflows, error } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .eq('status', status);

    // Format workflows with computed fields
    const formattedWorkflows = (workflows || []).map(workflow => {
      let executionSchema: JSONObject = {};
      let sampleInputs: JSONObject = {};

      try {
        const sequenceArgs = workflow.automation_sequence?.[0]?.arguments as JSONObject;
        if (sequenceArgs?.variables) {
          executionSchema = transformVariablesToSchema(sequenceArgs.variables as JSONObject);
          sampleInputs = extractDefaults(executionSchema);
        }
      } catch (e) {
        console.error(`Error parsing schema for workflow ${workflow.id}:`, e);
      }
      
      return {
        ...workflow,
        input_parameters: executionSchema, // The full schema
        sample_inputs: sampleInputs,       // The default values
      };
    });

    return NextResponse.json({
      success: true,
      workflows: formattedWorkflows,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit
      },
      filters: {
        category: category || 'all',
        status,
        applied_filters: {
          ...(category && { category }),
          status
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error listing workflows:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflows',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
