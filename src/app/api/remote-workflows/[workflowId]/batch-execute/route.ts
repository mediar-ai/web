import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

type JsonValue =
  | string
  | number
  | boolean
  | { [x: string]: JsonValue }
  | Array<JsonValue>;
type JsonObject = { [x: string]: JsonValue };

// Helper function to fetch workflow schema and identify array fields
const getArrayFields = async (
  workflowId: number,
  supabase: ReturnType<typeof createClient>
): Promise<Set<string>> => {
  const arrayFields = new Set<string>();

  try {
    // Fetch workflow data to get automation sequence
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('automation_sequence')
      .eq('id', workflowId)
      .single();

    if (workflowError || !workflow) {
      console.warn(
        `[WARN] Could not fetch workflow ${workflowId} for schema analysis:`,
        workflowError?.message
      );
      return arrayFields;
    }

    if (
      workflow.automation_sequence &&
      Array.isArray(workflow.automation_sequence) &&
      workflow.automation_sequence.length > 0
    ) {
      const mainSequence = workflow.automation_sequence[0];
      const variables = mainSequence?.arguments?.variables || {};

      console.log(
        '🔍 BATCH EXECUTE: Analyzing variables for array fields:',
        Object.keys(variables)
      );

      // Recursively find array-type fields
      const findArrayFields = (obj: Record<string, JsonValue>, prefix = '') => {
        Object.entries(obj).forEach(([key, value]) => {
          const fullKey = prefix ? `${prefix}.${key}` : key;

          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const valueObj = value as Record<string, JsonValue>;
            console.log(
              `🔍 BATCH EXECUTE: Checking ${fullKey}: type=${valueObj.type}, hasOptions=${!!valueObj.options}`
            );

            // Check if this is a parameter definition with array type
            if (valueObj.type === 'array') {
              arrayFields.add(fullKey);
              console.log(
                `✅ BATCH EXECUTE: Identified array field: ${fullKey}`
              );
            } else if (
              !valueObj.type &&
              !valueObj.description &&
              !valueObj.hasOwnProperty('default')
            ) {
              // This might be a nested group - recurse
              findArrayFields(valueObj, fullKey);
            }
          }
        });
      };

      findArrayFields(variables);
      console.log(
        '🔍 BATCH EXECUTE: Final array fields detected:',
        Array.from(arrayFields)
      );
    }
  } catch (error) {
    console.warn(
      '[WARN] Error analyzing workflow schema for array fields:',
      error
    );
  }

  return arrayFields;
};

// Helper function to set a value at a nested path
const set = (obj: JsonObject, path: string, value: JsonValue) => {
  const keys = path.split('.');
  let current: JsonObject = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as JsonObject;
  }
  current[keys[keys.length - 1]] = value;
  return obj;
};

// Helper to generate combinations with conditional logic awareness
const getCombinations = async (
  dynamicParams: Record<string, JsonValue[]>,
  arrayFields: Set<string>
): Promise<JsonObject[]> => {
  const keys = Object.keys(dynamicParams);
  if (keys.length === 0) return [{}];

  // Separate checkbox fields from true dynamic iteration parameters
  const checkboxParams: Record<string, JsonValue[]> = {};
  const iterationParams: Record<string, JsonValue[]> = {};

  console.log('🔍 CHECKBOX vs ITERATION ANALYSIS:');

  for (const [paramName, paramValues] of Object.entries(dynamicParams)) {
    if (arrayFields.has(paramName)) {
      // This is a checkbox/array field - treat the entire selection as static
      checkboxParams[paramName] = paramValues;
      console.log(
        `📋 Checkbox field: ${paramName} = [${paramValues.join(', ')}] (treated as single selection)`
      );
    } else {
      // This is a true iteration parameter
      iterationParams[paramName] = paramValues;
      console.log(
        `🔄 Iteration field: ${paramName} = [${paramValues.join(', ')}] (will create ${paramValues.length} combinations)`
      );
    }
  }

  // Check if we have conditional logic (branch-specific parameters) in iteration params
  const controllingParams: Record<string, JsonValue[]> = {};
  const branchSpecificParams: Record<string, string[]> = {}; // Maps controlling param values to their branch-specific param names
  const regularIterationParams: Record<string, JsonValue[]> = {};

  // Identify controlling parameters and their branch-specific parameters from iteration params only
  for (const [paramName, paramValues] of Object.entries(iterationParams)) {
    // Look for parameters that have branch-specific variants
    // For example: quote_type controls quote_value_face_value and quote_value_max_monthly_budget

    // Check if there are parameters that follow the pattern: {base}_{branch_value}
    // where {base} is derived from this parameter's name and {branch_value} matches one of this parameter's values
    const iterationKeys = Object.keys(iterationParams);
    const hasBranchSpecific = paramValues.some(value => {
      const normalizedValue = (value as string)
        .toLowerCase()
        .replace(/\s+/g, '_');
      // Look for parameters that end with this normalized value
      return iterationKeys.some(
        key =>
          key !== paramName && key.toLowerCase().endsWith('_' + normalizedValue)
      );
    });

    if (hasBranchSpecific) {
      // This is a controlling parameter
      controllingParams[paramName] = paramValues;

      // Find all branch-specific parameters for this controlling parameter
      paramValues.forEach(value => {
        const normalizedValue = (value as string)
          .toLowerCase()
          .replace(/\s+/g, '_');

        // Find parameters that end with this normalized value
        const matchingBranchParams = iterationKeys.filter(
          key =>
            key !== paramName &&
            key.toLowerCase().endsWith('_' + normalizedValue)
        );

        if (matchingBranchParams.length > 0) {
          if (!branchSpecificParams[value as string]) {
            branchSpecificParams[value as string] = [];
          }
          branchSpecificParams[value as string].push(...matchingBranchParams);
        }
      });
    } else {
      // Check if this is a branch-specific parameter
      const isBranchSpecific = Object.values(branchSpecificParams).some(
        branchParams => branchParams.includes(paramName)
      );

      if (!isBranchSpecific) {
        // This is a regular iteration parameter
        regularIterationParams[paramName] = paramValues;
      }
    }
  }

  console.log('🔍 CONDITIONAL LOGIC DEBUG:');
  console.log('📋 Controlling params:', controllingParams);
  console.log('🌿 Branch-specific params:', branchSpecificParams);
  console.log('📝 Regular iteration params:', regularIterationParams);

  let iterationCombinations: JsonObject[] = [];

  if (Object.keys(controllingParams).length > 0) {
    // We have conditional logic - calculate combinations per branch for iteration params only
    Object.entries(controllingParams).forEach(
      ([controlParam, controlValues]) => {
        controlValues.forEach(controlValue => {
          // For this specific branch, calculate combinations
          const branchParams: Record<string, JsonValue[]> = {
            ...regularIterationParams,
            [controlParam]: [controlValue], // Include the controlling parameter with this specific value
          };

          // Add branch-specific parameters for this control value
          const branchSpecificParamNames =
            branchSpecificParams[controlValue as string] || [];
          branchSpecificParamNames.forEach(branchParamName => {
            if (iterationParams[branchParamName]) {
              // Map back to original parameter name for the execution
              // e.g., "quote_value_face_value" -> "quote_value"
              // Use the actual branch value to calculate the correct suffix to remove
              const normalizedBranchValue = (controlValue as string)
                .toLowerCase()
                .replace(/\s+/g, '_');
              const suffix = `_${normalizedBranchValue}`;
              const originalParamName = branchParamName.endsWith(suffix)
                ? branchParamName.slice(0, -suffix.length)
                : branchParamName; // Fallback to original name if suffix doesn't match
              branchParams[originalParamName] =
                iterationParams[branchParamName];
            }
          });

          console.log(
            `🌿 Branch "${controlValue}" iteration params:`,
            branchParams
          );

          // Generate combinations for this branch (iteration params only)
          const branchCombinations = generateCartesianProduct(
            branchParams,
            new Set()
          ); // No array preservation for iteration params
          console.log(
            `🧮 Branch "${controlValue}" combinations (${branchCombinations.length}):`,
            branchCombinations
          );

          iterationCombinations.push(...branchCombinations);
        });
      }
    );

    console.log(
      `🎯 Total iteration combinations: ${iterationCombinations.length}`
    );
  } else {
    // No conditional logic, use simple Cartesian product for iteration params
    iterationCombinations = generateCartesianProduct(
      iterationParams,
      new Set()
    ); // No array preservation for iteration params
    console.log(
      `🧮 Simple iteration combinations: ${iterationCombinations.length}`
    );
  }

  // If no iteration parameters, create one base combination
  if (Object.keys(iterationParams).length === 0) {
    iterationCombinations = [{}];
    console.log(`📌 No iteration params - using single base combination`);
  }

  // Now merge checkbox selections with each iteration combination
  const finalCombinations: JsonObject[] = [];

  for (const iterationCombo of iterationCombinations) {
    const finalCombo: JsonObject = { ...iterationCombo };

    // Add checkbox selections as complete arrays (not individual values)
    for (const [checkboxParam, checkboxValues] of Object.entries(
      checkboxParams
    )) {
      finalCombo[checkboxParam] = checkboxValues; // Use the full array as selected
    }

    finalCombinations.push(finalCombo);
  }

  console.log(
    `🎯 Final combinations (iteration × checkbox merging): ${finalCombinations.length}`
  );
  console.log(`📋 Sample final combination:`, finalCombinations[0]);

  return finalCombinations;
};

// Helper function to generate Cartesian product with array field preservation
const generateCartesianProduct = (
  params: Record<string, JsonValue[]>,
  arrayFields: Set<string>
): JsonObject[] => {
  const keys = Object.keys(params);
  if (keys.length === 0) return [{}];

  const combinations: JsonObject[] = [{}];

  for (const key of keys) {
    const values = params[key];
    const newCombinations: JsonObject[] = [];

    for (const combination of combinations) {
      for (const value of values) {
        // Preserve array structure for array-type fields
        const finalValue = arrayFields.has(key) ? [value] : value;
        newCombinations.push({ ...combination, [key]: finalValue });
      }
    }

    combinations.length = 0;
    combinations.push(...newCombinations);
  }

  return combinations;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    const body = await request.json();

    const {
      static_parameters = {},
      dynamic_parameters = {},
      machine_id,
      version_number,
      // NEW: Partial execution parameters
      start_from_step,
      end_at_step,
      follow_fallback,
      execute_jumps_at_end,
    } = body;

    console.log('🚀 BATCH EXECUTE: Starting batch execution');
    console.log(
      '[BATCH] BATCH EXECUTE: Request body:',
      JSON.stringify(body, null, 2)
    );
    console.log('🔢 BATCH EXECUTE: Dynamic parameters:', dynamic_parameters);
    console.log(
      '[STATS] BATCH EXECUTE: Parameter count:',
      Object.keys(dynamic_parameters).length
    );
    console.log(
      '🎯 BATCH EXECUTE: Machine selection is managed by backend (UI input ignored).'
    );
    console.log(
      '📋 BATCH EXECUTE: Requested version:',
      version_number || 'active version'
    );

    // Simple debug - write to a file since console.log isn't showing
    const debugInfo = {
      timestamp: new Date().toISOString(),
      received_dynamic_parameters: dynamic_parameters,
      parameter_count: Object.keys(dynamic_parameters).length,
    };
    fs.writeFileSync(
      '/tmp/batch_debug.json',
      JSON.stringify(debugInfo, null, 2)
    );

    // If no dynamic parameters, treat it as a single execution with only static parameters
    // This allows the batch-execute endpoint to handle both single and batch executions
    const isSingleExecution = Object.keys(dynamic_parameters).length === 0;

    // Generate all unique parameter combinations
    const arrayFields = await getArrayFields(
      workflowIdNum,
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
      )
    );

    // 🔧 TEMPORARY FIX: Hardcode known array fields that should be treated as checkbox fields
    // These fields should be treated as a single selection, not iterated over
    const knownArrayFields = new Set(['product_types']);
    knownArrayFields.forEach(field => arrayFields.add(field));

    console.log(
      '🔧 BATCH EXECUTE: Combined array fields (detected + hardcoded):',
      Array.from(arrayFields)
    );

    const combinations = isSingleExecution
      ? [{}]
      : await getCombinations(dynamic_parameters, arrayFields);

    console.log(
      '🎯 BATCH EXECUTE: Generated combinations:',
      combinations.length
    );
    console.log(
      '📋 BATCH EXECUTE: Combination details:',
      JSON.stringify(combinations, null, 2)
    );

    // Write combination results to debug file
    const combinationDebug = {
      timestamp: new Date().toISOString(),
      generated_combinations: combinations.length,
      combination_details: combinations,
    };
    fs.appendFileSync(
      '/tmp/batch_debug.json',
      '\n' + JSON.stringify(combinationDebug, null, 2)
    );

    const totalJobs = combinations.length;
    console.log('🔢 BATCH EXECUTE: Total jobs to create:', totalJobs);

    // Cap the number of jobs to prevent abuse
    if (totalJobs > 5000) {
      return NextResponse.json(
        {
          success: false,
          error: `Batch size (${totalJobs}) exceeds the limit of 5000.`,
        },
        { status: 400 }
      );
    }

    // Initialize Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 🎯 Machine assignment with Load Balancer preference and optional user selection
    let assigned_machine_id: number | undefined = undefined;
    let assignment_reason: string = '';
    let mcp_endpoint: string | undefined = undefined;

    // Prefer explicit machine if provided
    if (typeof machine_id === 'number') {
      const { data: sel, error: selErr } = await supabase
        .from('remote_machines')
        .select('id, mcp_endpoint, name, status, health_status')
        .eq('id', machine_id)
        .single();
      if (!selErr && sel) {
        assigned_machine_id = sel.id;
        mcp_endpoint = sel.mcp_endpoint;
        assignment_reason = `User-selected machine (ID: ${machine_id})`;
      } else {
        return NextResponse.json(
          { success: false, error: `Machine ${machine_id} not found` },
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
        .select('id, mcp_endpoint, name, status, health_status')
        .eq('mcp_endpoint', lbBase)
        .single();

      if (!lbError && lbMachine) {
        assigned_machine_id = lbMachine.id;
        mcp_endpoint = lbMachine.mcp_endpoint;
        assignment_reason = 'Load balancer routing';
        if (lbMachine.status !== 'active') {
          console.warn(
            `[WARN] LB machine row is not active: ${lbMachine.status}`
          );
        }
      } else {
        console.warn(
          '[WARN] MCP_LB_BASE_URL set but no matching remote_machines row found; falling back to default machine 1'
        );
      }
    }

    // Fallback to machine 1 (existing behavior) if LB not configured or not found
    if (!mcp_endpoint) {
      assigned_machine_id = 1;
      assignment_reason =
        'Default assignment to Primary Windows VM (batch execution)';
      console.log(
        `🔍 Assigning batch to fallback machine ${assigned_machine_id} for workflow ${workflowIdNum}...`
      );

      const { data: machine, error: machineError } = await supabase
        .from('remote_machines')
        .select('mcp_endpoint, name, status, health_status')
        .eq('id', assigned_machine_id)
        .single();

      if (machineError || !machine) {
        console.error(
          `[ERROR] Failed to find fallback machine ${assigned_machine_id}:`,
          machineError
        );
        return NextResponse.json(
          {
            success: false,
            error: `Machine ${assigned_machine_id} not found`,
            details: 'Default machine not found',
          },
          { status: 400 }
        );
      }

      if (machine.status !== 'active') {
        console.error(
          `[ERROR] Machine ${assigned_machine_id} is not active: ${machine.status}`
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
      if (machine.health_status === 'unhealthy') {
        console.warn(
          `[WARN] Machine ${assigned_machine_id} is unhealthy but proceeding with execution`
        );
      }
      mcp_endpoint = machine.mcp_endpoint;
      console.log(
        `[SUCCESS] Assigned batch to machine ID ${assigned_machine_id} (${machine.name}): ${assignment_reason}`
      );
      console.log(`🔗 Machine endpoint: ${mcp_endpoint}`);
    }

    // Final guard
    if (!assigned_machine_id || !mcp_endpoint) {
      return NextResponse.json(
        { success: false, error: 'No available machine endpoint' },
        { status: 503 }
      );
    }

    const batch_id = `batch-${uuidv4()}`;
    const jobsToInsert = [];

    for (const combo of combinations) {
      // Create the final parameters for this specific job
      const finalParams = JSON.parse(JSON.stringify(static_parameters));
      for (const key in combo) {
        set(finalParams, key, combo[key]);
      }

      // 🎯 Include machine assignment, endpoint, and partial execution fields for each job
      jobsToInsert.push({
        workflow_id: workflowIdNum,
        status: 'queued',
        execution_params: finalParams,
        batch_id: batch_id,
        client_id: `batch-run-${batch_id}`,
        // Machine assignment fields
        assigned_machine_id,
        assignment_reason,
        machine_assignment_timestamp: new Date().toISOString(),
        assignment_method: 'auto',
        mcp_endpoint,
        // Version selection field
        version_number,
        // NEW: Partial execution fields
        start_from_step,
        end_at_step,
        follow_fallback,
        execute_jumps_at_end,
      });
    }

    console.log('[DB] BATCH EXECUTE: Inserting jobs into database...');
    console.log('📝 BATCH EXECUTE: Jobs to insert:', jobsToInsert.length);

    // Insert all jobs in a single query
    const { data: insertedJobs, error } = await supabase
      .from('workflow_executions')
      .insert(jobsToInsert)
      .select('id');

    if (error) {
      console.error('[ERROR] BATCH EXECUTE: Database insertion error:', error);
      throw error;
    }

    console.log('[SUCCESS] BATCH EXECUTE: Successfully inserted jobs');
    console.log(
      '🎯 BATCH EXECUTE: Execution IDs:',
      insertedJobs.map(j => j.id)
    );

    return NextResponse.json({
      success: true,
      message: `Successfully queued ${totalJobs} workflow execution${totalJobs === 1 ? '' : 's'}.`,
      batch_id: batch_id,
      execution_ids: insertedJobs.map(j => j.id),
    });
  } catch (error) {
    console.error('[ERROR] Error creating batch workflow execution:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create batch workflow execution',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
