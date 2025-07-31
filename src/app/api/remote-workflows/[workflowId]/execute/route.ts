import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Validation helper functions
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

function validateParameters(params: Record<string, unknown>, schema: Record<string, unknown>): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  // Check required parameters
  for (const [paramName, paramDef] of Object.entries(schema)) {
    if (paramDef && typeof paramDef === 'object') {
      const def = paramDef as Record<string, unknown>;
      
      // Check if parameter is required
      if (def.required === true && !(paramName in params)) {
        result.errors.push(`Required parameter '${paramName}' is missing`);
        result.isValid = false;
      }
      
      // Check parameter type if provided
      if (paramName in params && def.type) {
        const expectedType = def.type as string;
        const actualValue = params[paramName];
        
        if (!validateParameterType(actualValue, expectedType)) {
          result.errors.push(`Parameter '${paramName}' should be of type '${expectedType}' but received '${typeof actualValue}'`);
          result.isValid = false;
        }
      }
      
      // Check regex validation if provided
      if (paramName in params && def.regex && typeof def.regex === 'string') {
        const value = params[paramName];
        const stringValue = String(value);
        
        try {
          const regex = new RegExp(def.regex);
          if (!regex.test(stringValue)) {
            const customMessage = typeof def.validation_message === 'string' ? def.validation_message : `Parameter '${paramName}' does not match the required format`;
            result.errors.push(customMessage);
            result.isValid = false;
          }
        } catch (regexError) {
          console.error(`Invalid regex pattern for parameter '${paramName}':`, def.regex, regexError);
          result.errors.push(`Parameter '${paramName}' has an invalid regex pattern in schema`);
          result.isValid = false;
        }
      }
      
      // Check enum options if provided
      if (paramName in params && def.options && Array.isArray(def.options)) {
        const value = params[paramName];
        const validOptions = def.options.map(opt => 
          typeof opt === 'object' && opt !== null && 'value' in opt ? opt.value : opt
        );
        
        // Handle array fields - validate each element
        if (def.type === 'array' && Array.isArray(value)) {
          const invalidElements = value.filter(element => !validOptions.includes(element));
          if (invalidElements.length > 0) {
            result.errors.push(`Parameter '${paramName}' contains invalid values: ${invalidElements.join(', ')}. Valid options are: ${validOptions.join(', ')}`);
            result.isValid = false;
          }
        }
        // Handle single-value fields  
        else if (def.type !== 'array') {
        if (!validOptions.includes(value)) {
          result.errors.push(`Parameter '${paramName}' must be one of: ${validOptions.join(', ')}`);
            result.isValid = false;
          }
        }
        // Handle case where array is expected but non-array provided
        else if (def.type === 'array' && !Array.isArray(value)) {
          result.errors.push(`Parameter '${paramName}' should be an array but received '${typeof value}'`);
          result.isValid = false;
        }
      }
    }
  }

  // Check for unexpected parameters
  for (const paramName of Object.keys(params)) {
    if (!(paramName in schema)) {
      result.warnings.push(`Unexpected parameter '${paramName}' will be ignored`);
    }
  }

  return result;
}

function validateParameterType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'enum':
    case 'select':
      return typeof value === 'string'; // Enum values are typically strings
    default:
      return true; // Unknown types pass validation
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    const body = await request.json();
    
    // Extract detailed response preference from URL query params or request body
    const { searchParams } = new URL(request.url);
    const full_detailed_response = searchParams.get('full_detailed_response') === 'true' || body.full_detailed_response === true;
    
    console.log(`🚀 Executing workflow ${workflowIdNum} with parameters (detail_level: ${full_detailed_response ? 'full' : 'basic'}):`, body);
    
    // Strict parameter extraction - require "parameters" key
    if (!body.parameters) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required "parameters" key in request body',
          expected_format: {
            parameters: {
              "param1": "value1",
              "param2": "value2"
            }
          },
          help: {
            message: 'Parameters must be wrapped under "parameters" key',
            schema_endpoint: `/api/remote-workflows/${workflowIdNum}/schema`,
            docs_url: `/docs/api/remote-workflows`
          }
        },
        { status: 400 }
      );
    }

    if (typeof body.parameters !== 'object' || body.parameters === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Parameters must be a valid object',
          received_type: typeof body.parameters,
          help: {
            schema_endpoint: `/api/remote-workflows/${workflowIdNum}/schema`,
            docs_url: `/docs/api/remote-workflows`
          }
        },
        { status: 400 }
      );
    }

    const execution_params = body.parameters;
    const client_id = body.client_id || `web-${Date.now()}`;
    const execution_mode = body.execution_mode || 'async';
    const include_cache = body.include_cache === true; // New cache parameter
    const version_number = body.version_number; // Optional version to execute

    console.log('[SUCCESS] Extracted execution_params:', execution_params);
    console.log(`[FIX] Cache enabled: ${include_cache}`);
    console.log(`🔍 Full detailed response requested: ${full_detailed_response}`);
    console.log(`📋 Version requested: ${version_number || 'active version'}`);

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Check if workflow exists and is executable, and fetch automation sequence for validation
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('name, status, automation_sequence')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          execution_id: null
        },
        { status: 404 }
      );
    }

    if (workflow.status !== 'deployed') {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} is not executable (status: ${workflow.status})`,
          execution_id: null
        },
        { status: 400 }
      );
    }

    // Validate parameters against workflow schema if automation sequence is available
    let validationResult: ValidationResult | null = null;
    if (workflow.automation_sequence && Array.isArray(workflow.automation_sequence) && workflow.automation_sequence.length > 0) {
      try {
        console.log('🔍 Validating parameters against workflow schema...');
        
        const mainSequence = workflow.automation_sequence[0];
        if (mainSequence?.arguments?.variables) {
          const schema = mainSequence.arguments.variables as Record<string, unknown>;
          validationResult = validateParameters(execution_params, schema);
          
          if (!validationResult.isValid) {
            console.log('[ERROR] Parameter validation failed:', validationResult.errors);
            return NextResponse.json(
              {
                success: false,
                error: 'Parameter validation failed',
                validation_errors: validationResult.errors,
                validation_warnings: validationResult.warnings,
                execution_id: null,
                help: {
                  message: 'Check the workflow schema endpoint for valid parameters',
                  schema_endpoint: `/api/remote-workflows/${workflowIdNum}/schema`,
                  docs_url: `/docs/api/remote-workflows`
                }
              },
              { status: 400 }
            );
          }
          
          if (validationResult.warnings.length > 0) {
            console.log('[WARN] Parameter validation warnings:', validationResult.warnings);
          }
          
          console.log('[SUCCESS] Parameter validation passed');
        }
      } catch (validationError) {
        console.warn('[WARN] Parameter validation failed due to error:', validationError);
        // Continue execution even if validation fails - don't block workflow execution
      }
    } else {
      console.log('[WARN] No automation sequence found for validation - proceeding without parameter validation');
    }

    // 🎯 Simple machine assignment: Default to machine ID 1 (Primary Windows VM)
    console.log(`🔍 Assigning to default machine for workflow ${workflowIdNum}...`);
    
    const assigned_machine_id: number = 1;
    const assignment_reason = 'Default assignment to Primary Windows VM';
    
    // Look up machine endpoint
    const { data: machine, error: machineError } = await supabase
      .from('remote_machines')
      .select('mcp_endpoint')
      .eq('id', assigned_machine_id)
      .single();

    if (machineError || !machine) {
      console.error(`[ERROR] Failed to find machine ${assigned_machine_id}:`, machineError);
      return NextResponse.json(
        { error: `Machine ${assigned_machine_id} not found in remote_machines table` },
        { status: 500 }
      );
    }

    const mcp_endpoint = machine.mcp_endpoint;
    console.log(`[SUCCESS] Assigned to machine ID ${assigned_machine_id}: ${assignment_reason}`);
    console.log(`🔗 Machine endpoint: ${mcp_endpoint}`);

    // ✨ NEW: Check cache first if requested
    if (include_cache) {
      try {
        // Pass detailed response parameter to cache endpoint
        const cacheUrl = `${request.url.split('/api')[0]}/api/remote-workflows/cache${full_detailed_response ? '?full_detailed_response=true' : ''}`;
        
        const cacheResponse = await fetch(cacheUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workflow_id: workflowIdNum,
            parameters: execution_params
          })
        });

        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          
          if (cacheData.success && cacheData.cached) {
            console.log(`🚀 Cache HIT! Returning cached results and queuing background execution`);
            
            // Create background execution record with machine assignment
            const modal_call_id = `modal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const { data: execution, error: executionError } = await supabase
              .from('workflow_executions')
              .insert({
                workflow_id: workflowIdNum,
                client_id,
                status: 'queued',
                execution_params: execution_params,
                modal_call_id,
                // 🎯 Include machine assignment for background execution
                assigned_machine_id,
                assignment_reason: 'Default assignment to Primary Windows VM (cache refresh)',
                machine_assignment_timestamp: new Date().toISOString(),
                assignment_method: 'auto',
                mcp_endpoint,
                // 🎯 Include version selection for background execution
                version_number
              })
              .select()
              .single();

            if (executionError) {
              throw executionError;
            }

            console.log(`[SUCCESS] Created background execution ${execution.id} for cache refresh`);
            
            // Return cached results with background execution info (using new cache response structure)
            const cachedExecution = cacheData.execution;
            
            return NextResponse.json({
              success: true,
              cached: true,
              execution_id: execution.id, // Background execution for freshness
              workflow_id: workflowIdNum,
              workflow_name: workflow.name,
              status: 'queued', // Background execution status
              modal_call_id: modal_call_id,
              created_at: new Date().toISOString(),
              execution_mode,
              client_id,
              message: `Cache hit! Returning instant results from execution ${cacheData.cache_info.source_execution_id}. Background execution ${execution.id} queued for cache refresh.`,
              
              // Cached results (using new structure)
              cached_results: {
                quotes: cachedExecution.quotes,
                source_execution_id: cacheData.cache_info.source_execution_id,
                cache_timestamp: cacheData.cache_info.cache_timestamp,
                speed_improvement: cacheData.cache_info.speed_improvement
              },
              
              // Include validation info if available
              ...(validationResult && {
                validation: {
                  parameters_validated: true,
                  warnings: validationResult.warnings.length > 0 ? validationResult.warnings : undefined,
                  parameter_count: Object.keys(execution_params).length
                }
              }),
              
              // Add helpful endpoints
              endpoints: {
                status: `/api/remote-workflows/executions/${execution.id}`,
                results: `/api/remote-workflows/executions/${execution.id}`,
                schema: `/api/remote-workflows/${workflowIdNum}/schema`
              }
            }, { status: 200 });
          }
        }
      } catch (cacheError) {
        console.warn('[WARN] Cache lookup failed, proceeding with normal execution:', cacheError);
        // Continue with normal execution if cache fails
      }

      console.log(`⏳ No cache hit, proceeding with normal execution...`);
    }

    // Create execution record in database with 'queued' status and machine assignment
    // The appropriate Modal executor will pick it up based on assigned_machine_id
    const modal_call_id = `modal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const executionData = {
      workflow_id: workflowIdNum,
      client_id,
      status: 'queued',
      execution_params: execution_params,
      modal_call_id,
      // 🎯 Include machine assignment and endpoint fields
      assigned_machine_id,
      assignment_reason,
      machine_assignment_timestamp: new Date().toISOString(),
      assignment_method: 'auto',
      mcp_endpoint,
      // 🎯 Include version selection
      version_number
    };
    
    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .insert(executionData)
      .select()
      .single();

    if (executionError) {
      throw executionError;
    }

    console.log(`[SUCCESS] Created execution ${execution.id} for workflow "${workflow.name}" - will be processed by Modal scheduler`);
    
    // Return immediate response - Modal will process this asynchronously
    const response = { 
      success: true,
      execution_id: execution.id,
      workflow_id: workflowIdNum,
      workflow_name: workflow.name,
      status: 'queued',
      modal_call_id: modal_call_id,
      created_at: new Date().toISOString(),
      execution_mode,
      client_id,
      message: `Workflow execution queued successfully. Modal will process it within 10 seconds. Use execution ID ${execution.id} to monitor progress.`,
      // Include validation info if available
      ...(validationResult && {
        validation: {
          parameters_validated: true,
          warnings: validationResult.warnings.length > 0 ? validationResult.warnings : undefined,
          parameter_count: Object.keys(execution_params).length
        }
      }),
      // Add helpful endpoints
      endpoints: {
        status: `/api/remote-workflows/executions/${execution.id}`,
        results: `/api/remote-workflows/executions/${execution.id}`,
        schema: `/api/remote-workflows/${workflowIdNum}/schema`
      }
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('[ERROR] Error executing workflow:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute workflow',
        details: error instanceof Error ? error.message : String(error),
        execution_id: null
      },
      { status: 500 }
    );
    }
  }


