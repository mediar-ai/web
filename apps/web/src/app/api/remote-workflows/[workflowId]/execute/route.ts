import {
  cacheResponse,
  extractRequestParams,
  normalizeEndpointPath,
} from '@/lib/responseCache';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

// Validation helper functions
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

function validateParameters(
  params: Record<string, unknown>,
  schema: Record<string, unknown>
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
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
          result.errors.push(
            `Parameter '${paramName}' should be of type '${expectedType}' but received '${typeof actualValue}'`
          );
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
            const customMessage =
              typeof def.validation_message === 'string'
                ? def.validation_message
                : `Parameter '${paramName}' does not match the required format`;
            result.errors.push(customMessage);
            result.isValid = false;
          }
        } catch (regexError) {
          console.error(
            `Invalid regex pattern for parameter '${paramName}':`,
            def.regex,
            regexError
          );
          result.errors.push(
            `Parameter '${paramName}' has an invalid regex pattern in schema`
          );
          result.isValid = false;
        }
      }

      // Check enum options if provided
      if (paramName in params && def.options && Array.isArray(def.options)) {
        const value = params[paramName];
        const validOptions = def.options.map(opt =>
          typeof opt === 'object' && opt !== null && 'value' in opt
            ? opt.value
            : opt
        );

        // Handle array fields - validate each element
        if (def.type === 'array' && Array.isArray(value)) {
          const invalidElements = value.filter(
            element => !validOptions.includes(element)
          );
          if (invalidElements.length > 0) {
            result.errors.push(
              `Parameter '${paramName}' contains invalid values: ${invalidElements.join(', ')}. Valid options are: ${validOptions.join(', ')}`
            );
            result.isValid = false;
          }
        }
        // Handle single-value fields
        else if (def.type !== 'array') {
          if (!validOptions.includes(value)) {
            result.errors.push(
              `Parameter '${paramName}' must be one of: ${validOptions.join(', ')}`
            );
            result.isValid = false;
          }
        }
        // Handle case where array is expected but non-array provided
        else if (def.type === 'array' && !Array.isArray(value)) {
          result.errors.push(
            `Parameter '${paramName}' should be an array but received '${typeof value}'`
          );
          result.isValid = false;
        }
      }
    }
  }

  // Check for unexpected parameters
  for (const paramName of Object.keys(params)) {
    if (!(paramName in schema)) {
      result.warnings.push(
        `Unexpected parameter '${paramName}' will be ignored`
      );
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
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
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
    // Check if this is a cron-triggered execution
    const isCronExecution = request.headers.get('X-Cron-Execution') === 'true';
    const authHeader = request.headers.get('Authorization');

    // Check for Vercel bypass token in various locations
    const url = new URL(request.url);
    const bypassTokenFromQuery = url.searchParams.get('x-vercel-protection-bypass');
    const bypassTokenFromHeader = request.headers.get('x-vercel-protection-bypass');
    const expectedBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

    let authenticatedUserId: string | null = null;
    let has: any = null;
    let orgId: string | null | undefined = null;

    // STEP 1: Authenticate
    if (isCronExecution) {
      // For cron executions, verify BOTH the service role key AND bypass token
      const expectedKey = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

      // Check service role key
      if (authHeader !== expectedKey) {
        console.warn('[SECURITY] Invalid service role key for cron execution');
        return NextResponse.json(
          { error: 'Unauthorized - Invalid service role key' },
          { status: 401 }
        );
      }

      // Additionally check bypass token if it's configured
      if (expectedBypassToken) {
        const providedToken = bypassTokenFromQuery || bypassTokenFromHeader;
        if (providedToken !== expectedBypassToken) {
          console.warn('[SECURITY] Invalid or missing Vercel bypass token for cron execution');
          console.warn(`  Expected token present: ${!!expectedBypassToken}`);
          console.warn(`  Received token in query: ${!!bypassTokenFromQuery}`);
          console.warn(`  Received token in header: ${!!bypassTokenFromHeader}`);
          return NextResponse.json(
            { error: 'Unauthorized - Invalid Vercel bypass token' },
            { status: 401 }
          );
        }
        console.log('[AUTH] Vercel bypass token validated successfully');
      }

      console.log('[AUTH] Cron execution authenticated via service role key and bypass token');
      // For cron executions, we skip user-based auth checks
      authenticatedUserId = 'cron-scheduler';
    } else {
      // For regular user requests, use Clerk authentication
      const authResult = await auth();
      authenticatedUserId = authResult.userId;
      has = authResult.has;
      orgId = authResult.orgId;

      if (!authenticatedUserId) {
        console.warn('[SECURITY] Unauthenticated request to execute workflow');
        return NextResponse.json(
          { error: 'Unauthorized - Authentication required' },
          { status: 401 }
        );
      }
    }

    const startTime = Date.now();
    const { workflowId } = await params;
    const body = await request.json();

    // Early Supabase setup for ID resolution
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        {
          success: false,
          error: resolveError || `Workflow ${workflowId} not found`,
          execution_id: null,
        },
        { status: 404 }
      );
    }

    // Extract detailed response preference from URL query params or request body
    const { searchParams } = new URL(request.url);
    const full_detailed_response =
      searchParams.get('full_detailed_response') === 'true' ||
      body.full_detailed_response === true;

    console.log(
      `🚀 Executing workflow ${workflowIdNum} with parameters (detail_level: ${full_detailed_response ? 'full' : 'basic'}):`,
      body
    );

    // Strict parameter extraction - require "parameters" key
    if (!body.parameters) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required "parameters" key in request body',
          expected_format: {
            parameters: {
              param1: 'value1',
              param2: 'value2',
            },
          },
          help: {
            message: 'Parameters must be wrapped under "parameters" key',
            schema_endpoint: `/api/remote-workflows/${workflowIdNum}/schema`,
            docs_url: `/docs/api/remote-workflows`,
          },
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
            docs_url: `/docs/api/remote-workflows`,
          },
        },
        { status: 400 }
      );
    }

    const execution_params = body.parameters;
    const user_selected_machine_id = Number.isFinite(body.machine_id)
      ? (body.machine_id as number)
      : undefined;
    const client_id = body.client_id || `web-${Date.now()}`;
    const execution_mode = body.execution_mode || 'async';
    const include_cache = body.include_cache === true; // New cache parameter
    const executor_type = body.executor_type || 'python'; // Default to Python executor for backwards compatibility

    console.log('[SUCCESS] Extracted execution_params:', execution_params);
    console.log(`[FIX] Cache enabled: ${include_cache}`);
    console.log(
      `🔍 Full detailed response requested: ${full_detailed_response}`
    );
    console.log(`🚀 Executor type: ${executor_type}`);

    // STEP 2: Check if workflow exists and verify authorization
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('name, status, automation_sequence, version, created_by')
      .eq('id', workflowIdNum)
      .single();

    // Set version_number: use provided version or fallback to workflow's current version
    const version_number = body.version_number || workflow?.version;
    console.log(`📋 Version to execute: ${version_number || 'none'}`);

    if (workflowError || !workflow) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          execution_id: null,
        },
        { status: 404 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    // Skip authorization checks for cron executions (already authenticated via service role key)
    if (!isCronExecution) {
      // Fetch organization_id from base table (not in view)
      const { data: workflowBase } = await supabase
        .from('deployed_workflows')
        .select('organization_id')
        .eq('id', workflowIdNum)
        .single();

      const workflow_organization_id = workflowBase?.organization_id;

      const isOwner = workflow.created_by === authenticatedUserId;
      const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
      const isSameOrg = workflow_organization_id && workflow_organization_id === orgId;

      // Check workflow_organization_access table for organization-based access
      // Allow ANY member of an organization with access (not just admins)
      let hasOrgAccess = false;
      if (orgId) {
        const { data: orgAccess } = await supabase
          .from('workflow_organization_access')
          .select('organization_id')
          .eq('workflow_id', workflowIdNum)
          .eq('organization_id', orgId)
          .single();

        hasOrgAccess = !!orgAccess;
      }

      // Allow execution if:
      // - User is the workflow owner
      // - User is org admin in the same org (legacy organization_id field)
      // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
      if (!isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
        console.warn(
          `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized execution for workflow ${workflowIdNum}`
        );
        return NextResponse.json(
          { error: 'Forbidden - You do not have permission to execute this workflow' },
          { status: 403 }
        );
      }
    } else {
      console.log('[AUTH] Cron execution - will validate machine access later');
      // Note: We still need to validate machine access for cron executions
      // This will be done after machine assignment
    }

    if (workflow.status !== 'deployed') {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} is not executable (status: ${workflow.status})`,
          execution_id: null,
        },
        { status: 400 }
      );
    }

    // Validate parameters against workflow schema if automation sequence is available
    let validationResult: ValidationResult | null = null;
    if (
      workflow.automation_sequence &&
      Array.isArray(workflow.automation_sequence) &&
      workflow.automation_sequence.length > 0
    ) {
      try {
        console.log('🔍 Validating parameters against workflow schema...');

        const mainSequence = workflow.automation_sequence[0];
        if (mainSequence?.arguments?.variables) {
          const schema = mainSequence.arguments.variables as Record<
            string,
            unknown
          >;
          validationResult = validateParameters(execution_params, schema);

          if (!validationResult.isValid) {
            console.log(
              '[ERROR] Parameter validation failed:',
              validationResult.errors
            );
            return NextResponse.json(
              {
                success: false,
                error: 'Parameter validation failed',
                validation_errors: validationResult.errors,
                validation_warnings: validationResult.warnings,
                execution_id: null,
                help: {
                  message:
                    'Check the workflow schema endpoint for valid parameters',
                  schema_endpoint: `/api/remote-workflows/${workflowIdNum}/schema`,
                  docs_url: `/docs/api/remote-workflows`,
                },
              },
              { status: 400 }
            );
          }

          if (validationResult.warnings.length > 0) {
            console.log(
              '[WARN] Parameter validation warnings:',
              validationResult.warnings
            );
          }

          console.log('[SUCCESS] Parameter validation passed');
        }
      } catch (validationError) {
        console.warn(
          '[WARN] Parameter validation failed due to error:',
          validationError
        );
        // Continue execution even if validation fails - don't block workflow execution
      }
    } else {
      console.log(
        '[WARN] No automation sequence found for validation - proceeding without parameter validation'
      );
    }

    // 🎯 Machine assignment with Load Balancer preference
    let assigned_machine_id: number | undefined = undefined;
    let assignment_reason: string = '';
    let mcp_endpoint: string | undefined = undefined;

    // If client selected a specific machine/cluster, honor it
    if (user_selected_machine_id) {
      const { data: machine, error: machineErr } = await supabase
        .from('remote_machines')
        .select('id, mcp_endpoint, name, status')
        .eq('id', user_selected_machine_id)
        .single();
      if (!machineErr && machine) {
        // Validate machine status before allowing execution
        if (machine.status !== 'active') {
          console.error(
            `[ERROR] User attempted to select inactive machine ${user_selected_machine_id}: status=${machine.status}`
          );
          return NextResponse.json(
            {
              success: false,
              error: `Machine "${machine.name}" is not active (status: ${machine.status})`,
              machine_status: machine.status,
              available_machines_endpoint: '/api/machines?status=active',
            },
            { status: 400 }
          );
        }
        
        assigned_machine_id = machine.id;
        mcp_endpoint = machine.mcp_endpoint;
        assignment_reason = `User-selected machine (ID: ${user_selected_machine_id})`;
        console.log(`[SUCCESS] User-selected machine validated: ${machine.name} (status: ${machine.status})`);
      } else {
        return NextResponse.json(
          {
            success: false,
            error: `Machine ${user_selected_machine_id} not found`,
          },
          { status: 400 }
        );
      }
    }

    const lbBase = process.env.MCP_LB_BASE_URL;
    if (!assigned_machine_id && lbBase) {
      console.log(
        `🔍 Using Load Balancer endpoint from env MCP_LB_BASE_URL for workflow ${workflowIdNum}...`
      );
      const { data: lbMachine, error: lbError } = await supabase
        .from('remote_machines')
        .select('id, mcp_endpoint, name, status')
        .eq('mcp_endpoint', lbBase)
        .single();

      if (!lbError && lbMachine) {
        assigned_machine_id = lbMachine.id;
        mcp_endpoint = lbMachine.mcp_endpoint;
        assignment_reason = 'Load balancer routing';
      } else {
        console.warn(
          '[WARN] MCP_LB_BASE_URL set but no matching remote_machines row found; falling back to optimal assignment'
        );
      }
    }

    // Fallback to optimal assignment when LB not configured or not found
    if (!mcp_endpoint) {
      console.log(
        `🔍 Getting optimal machine assignment for workflow ${workflowIdNum}...`
      );

      // First check if this workflow has an exclusive assignment
      const { data: exclusiveAssignment } = await supabase
        .from('workflow_machine_assignments')
        .select('machine_id, assignment_type, remote_machines!inner(name)')
        .eq('workflow_id', workflowIdNum)
        .eq('assignment_type', 'exclusive')
        .eq('is_active', true)
        .single();

      const isExclusive = !!exclusiveAssignment;

      const { data: optimalMachine, error: optimalError } = await supabase.rpc(
        'get_optimal_machine_for_workflow',
        {
          p_workflow_id: workflowIdNum,
          p_execution_params: execution_params,
        }
      );

      if (!optimalError && optimalMachine && optimalMachine.length > 0) {
        const machine = optimalMachine[0];
        assigned_machine_id = machine.machine_id;
        assignment_reason = machine.assignment_reason;

        const { data: machineDetails, error: machineError } = await supabase
          .from('remote_machines')
          .select('mcp_endpoint')
          .eq('id', assigned_machine_id)
          .single();

        if (machineError || !machineDetails) {
          console.error(
            `[ERROR] Failed to get machine endpoint for ${assigned_machine_id}:`,
            machineError
          );
          return NextResponse.json(
            { error: `Machine ${assigned_machine_id} endpoint not found` },
            { status: 500 }
          );
        }
        mcp_endpoint = machineDetails.mcp_endpoint;
      } else {
        // If this workflow has an EXCLUSIVE assignment, reject execution
        if (isExclusive && exclusiveAssignment) {
          const machines = exclusiveAssignment.remote_machines as
            | { name: string }
            | { name: string }[];
          const machineName = Array.isArray(machines)
            ? machines[0]?.name
            : machines?.name;

          console.error(
            `[ERROR] Exclusive machine ${machineName} (ID: ${exclusiveAssignment.machine_id}) unavailable for workflow ${workflowIdNum}`
          );
          return NextResponse.json(
            {
              success: false,
              error: `Workflow requires exclusive machine that is currently unavailable`,
              details: {
                workflow_id: workflowIdNum,
                exclusive_machine_id: exclusiveAssignment.machine_id,
                exclusive_machine_name: machineName,
                reason:
                  'Exclusive machine is either inactive or at maximum capacity',
                suggestion:
                  'Please wait for the exclusive machine to become available, or remove the exclusive assignment to allow auto-assignment',
              },
              execution_id: null,
            },
            { status: 503 }
          );
        }

        // For non-exclusive workflows, fallback to machine 1
        console.log(
          `[INFO] No optimal machine found, using fallback Machine 1`
        );
        assigned_machine_id = 1;
        assignment_reason =
          'Fallback to Primary Windows VM (no optimal assignment found)';

        const { data: fallbackMachine, error: fallbackError } = await supabase
          .from('remote_machines')
          .select('mcp_endpoint')
          .eq('id', 1)
          .single();

        if (fallbackError || !fallbackMachine) {
          console.error(
            `[ERROR] Failed to find fallback machine 1:`,
            fallbackError
          );
          return NextResponse.json(
            { error: `Fallback machine 1 not found in remote_machines table` },
            { status: 500 }
          );
        }
        mcp_endpoint = fallbackMachine.mcp_endpoint;
      }
    }

    if (!assigned_machine_id || !mcp_endpoint) {
      return NextResponse.json(
        { error: 'No available machine endpoint' },
        { status: 503 }
      );
    }

    // SECURITY: Validate machine access for the workflow's organization
    // This is critical for cron executions which bypass user auth checks
    const { data: workflowOrg } = await supabase
      .from('deployed_workflows')
      .select('organization_id')
      .eq('id', workflowIdNum)
      .single();

    const workflowOrgId = workflowOrg?.organization_id;

    if (workflowOrgId) {
      // Check if the organization has access to the assigned machine
      const { data: hasAccess } = await supabase.rpc('check_machine_access', {
        p_machine_id: assigned_machine_id,
        p_organization_id: workflowOrgId
      });

      if (!hasAccess) {
        console.error(
          `[SECURITY] Organization ${workflowOrgId} does not have access to machine ${assigned_machine_id} for workflow ${workflowIdNum}`
        );

        // Try to find an alternative machine the org has access to
        // Must filter by organization access (is_global=true OR has explicit assignment)
        const { data: alternativeMachine } = await supabase
          .from('available_machines_with_load')
          .select('id, name, mcp_endpoint, is_global')
          .eq('status', 'active')
          .gt('available_capacity', 0)
          .order('load_percentage');

        // Filter to machines the org actually has access to
        let accessibleMachine = null;
        if (alternativeMachine && alternativeMachine.length > 0) {
          for (const machine of alternativeMachine) {
            // Check if org has access to this machine
            const { data: machineAccess } = await supabase.rpc('check_machine_access', {
              p_machine_id: machine.id,
              p_organization_id: workflowOrgId
            });
            if (machineAccess) {
              accessibleMachine = machine;
              break;
            }
          }
        }

        if (!accessibleMachine) {
          return NextResponse.json(
            {
              error: `Organization ${workflowOrgId} does not have access to machine ${assigned_machine_id}`,
              details: 'No alternative machines available that this organization has access to'
            },
            { status: 403 }
          );
        }

        // Use the alternative machine
        console.log(
          `[INFO] Switching to alternative machine ${accessibleMachine.id} that org ${workflowOrgId} has access to`
        );
        assigned_machine_id = accessibleMachine.id;
        mcp_endpoint = accessibleMachine.mcp_endpoint;
        assignment_reason = 'Organization-accessible fallback machine';
      }
    }

    console.log(
      `[SUCCESS] Assigned to machine ID ${assigned_machine_id}: ${assignment_reason}`
    );
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
            parameters: execution_params,
          }),
        });

        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();

          if (cacheData.success && cacheData.cached) {
            console.log(
              `🚀 Cache HIT! Returning cached results and queuing background execution`
            );

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
                assignment_reason:
                  'Default assignment to Primary Windows VM (cache refresh)',
                machine_assignment_timestamp: new Date().toISOString(),
                assignment_method: 'auto',
                mcp_endpoint,
                // 🎯 Include version selection for background execution
                version_number,
                // 🎯 Include executor type for routing to Python or Rust executor
                executor_type,
              })
              .select()
              .single();

            if (executionError) {
              throw executionError;
            }

            console.log(
              `[SUCCESS] Created background execution ${execution.id} for cache refresh`
            );

            // Return cached results with background execution info (using new cache response structure)
            const cachedExecution = cacheData.execution;

            return NextResponse.json(
              {
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
                  speed_improvement: cacheData.cache_info.speed_improvement,
                },

                // Include validation info if available
                ...(validationResult && {
                  validation: {
                    parameters_validated: true,
                    warnings:
                      validationResult.warnings.length > 0
                        ? validationResult.warnings
                        : undefined,
                    parameter_count: Object.keys(execution_params).length,
                  },
                }),

                // Add helpful endpoints
                endpoints: {
                  status: `/api/remote-workflows/executions/${execution.id}`,
                  results: `/api/remote-workflows/executions/${execution.id}`,
                  schema: `/api/remote-workflows/${workflowIdNum}/schema`,
                },
              },
              { status: 200 }
            );
          }
        }
      } catch (cacheError) {
        console.warn(
          '[WARN] Cache lookup failed, proceeding with normal execution:',
          cacheError
        );
        // Continue with normal execution if cache fails
      }

      console.log(`⏳ No cache hit, proceeding with normal execution...`);
    }

    // Create execution record in database with 'queued' status and machine assignment
    // The appropriate executor (Python/Modal or Rust) will pick it up based on executor_type
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
      version_number,
      // 🎯 Include executor type for routing to Python or Rust executor
      executor_type,
    };

    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .insert(executionData)
      .select()
      .single();

    if (executionError) {
      throw executionError;
    }

    console.log(
      `[SUCCESS] Created execution ${execution.id} for workflow "${workflow.name}" - will be processed by ${executor_type} executor`
    );

    // Update machine's last activity timestamp for "last used" tracking
    if (assigned_machine_id) {
      await supabase
        .from('remote_machines')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', assigned_machine_id);
    }

    // Return immediate response - executor will process this asynchronously
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
      message: `Workflow execution queued successfully. The ${executor_type} executor will process it within 10 seconds. Use execution ID ${execution.id} to monitor progress.`,
      // Include validation info if available
      ...(validationResult && {
        validation: {
          parameters_validated: true,
          warnings:
            validationResult.warnings.length > 0
              ? validationResult.warnings
              : undefined,
          parameter_count: Object.keys(execution_params).length,
        },
      }),
      // Add helpful endpoints
      endpoints: {
        status: `/api/remote-workflows/executions/${execution.id}`,
        results: `/api/remote-workflows/executions/${execution.id}`,
        schema: `/api/remote-workflows/${workflowIdNum}/schema`,
      },
    };

    // Cache the successful response for documentation
    const endpointPath = normalizeEndpointPath(
      `/api/remote-workflows/[workflowId]/execute`
    );
    const requestParams = extractRequestParams(request, { workflowId });
    await cacheResponse({
      endpointPath,
      httpMethod: 'POST',
      statusCode: 200,
      responseBody: response,
      requestParams,
      executionTimeMs: Date.now() - startTime,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[ERROR] Error executing workflow:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute workflow',
        details: error instanceof Error ? error.message : String(error),
        execution_id: null,
      },
      { status: 500 }
    );
  }
}
