import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

type JsonValue = string | number | boolean | { [x: string]: JsonValue } | Array<JsonValue>;
type JsonObject = { [x: string]: JsonValue };

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
const getCombinations = (dynamicParams: Record<string, JsonValue[]>) : JsonObject[] => {
  const keys = Object.keys(dynamicParams);
  if (keys.length === 0) return [{}];

  // Check if we have conditional logic (branch-specific parameters)
  const controllingParams: Record<string, JsonValue[]> = {};
  const branchSpecificParams: Record<string, string[]> = {}; // Maps controlling param values to their branch-specific param names
  const regularParams: Record<string, JsonValue[]> = {};

  // Identify controlling parameters and their branch-specific parameters
  for (const [paramName, paramValues] of Object.entries(dynamicParams)) {
    // Look for parameters that have branch-specific variants
    // For example: quote_type controls quote_value_face_value and quote_value_max_monthly_budget
    
    // Check if there are parameters that follow the pattern: {base}_{branch_value}
    // where {base} is derived from this parameter's name and {branch_value} matches one of this parameter's values
    const hasBranchSpecific = paramValues.some(value => {
      const normalizedValue = (value as string).toLowerCase().replace(/\s+/g, '_');
      // Look for parameters that end with this normalized value
      return keys.some(key => 
        key !== paramName && 
        key.toLowerCase().endsWith('_' + normalizedValue)
      );
    });
    
    if (hasBranchSpecific) {
      // This is a controlling parameter
      controllingParams[paramName] = paramValues;
      
      // Find all branch-specific parameters for this controlling parameter
      paramValues.forEach(value => {
        const normalizedValue = (value as string).toLowerCase().replace(/\s+/g, '_');
        
        // Find parameters that end with this normalized value
        const matchingBranchParams = keys.filter(key => 
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
      const isBranchSpecific = Object.values(branchSpecificParams).some(branchParams =>
        branchParams.includes(paramName)
      );
      
      if (!isBranchSpecific) {
        // This is a regular parameter
        regularParams[paramName] = paramValues;
      }
    }
  }

  console.log('🔍 CONDITIONAL LOGIC DEBUG:');
  console.log('📋 Controlling params:', controllingParams);
  console.log('🌿 Branch-specific params:', branchSpecificParams);
  console.log('📝 Regular params:', regularParams);

  if (Object.keys(controllingParams).length > 0) {
    // We have conditional logic - calculate combinations per branch
    const allCombinations: JsonObject[] = [];
    
    Object.entries(controllingParams).forEach(([controlParam, controlValues]) => {
      controlValues.forEach(controlValue => {
        // For this specific branch, calculate combinations
        const branchParams: Record<string, JsonValue[]> = {
          ...regularParams,
          [controlParam]: [controlValue] // Include the controlling parameter with this specific value
        };
        
        // Add branch-specific parameters for this control value
        const branchSpecificParamNames = branchSpecificParams[controlValue as string] || [];
        branchSpecificParamNames.forEach(branchParamName => {
          if (dynamicParams[branchParamName]) {
            // Map back to original parameter name for the execution
            // e.g., "quote_value_face_value" -> "quote_value"
            const parts = branchParamName.split('_');
            const originalParamName = parts.slice(0, -1).join('_'); // Remove the last part (branch identifier)
            branchParams[originalParamName] = dynamicParams[branchParamName];
          }
        });
        
        console.log(`🌿 Branch "${controlValue}" params:`, branchParams);
        
        // Generate combinations for this branch
        const branchCombinations = generateCartesianProduct(branchParams);
        console.log(`🧮 Branch "${controlValue}" combinations (${branchCombinations.length}):`, branchCombinations);
        
        allCombinations.push(...branchCombinations);
      });
    });
    
    console.log(`🎯 Total conditional combinations: ${allCombinations.length}`);
    return allCombinations;
  } else {
    // No conditional logic, use simple Cartesian product
    const combinations = generateCartesianProduct(dynamicParams);
    console.log(`🧮 Simple combinations: ${combinations.length}`);
    return combinations;
  }
};

// Helper function to generate Cartesian product
const generateCartesianProduct = (params: Record<string, JsonValue[]>): JsonObject[] => {
  const keys = Object.keys(params);
  if (keys.length === 0) return [{}];
  
  const combinations: JsonObject[] = [{}];
  
  for (const key of keys) {
    const values = params[key];
    const newCombinations: JsonObject[] = [];
    
    for (const combination of combinations) {
      for (const value of values) {
        newCombinations.push({ ...combination, [key]: value });
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
    } = body;

    console.log('🚀 BATCH EXECUTE: Starting batch execution');
    console.log('📦 BATCH EXECUTE: Request body:', JSON.stringify(body, null, 2));
    console.log('🔢 BATCH EXECUTE: Dynamic parameters:', dynamic_parameters);
    console.log('📊 BATCH EXECUTE: Parameter count:', Object.keys(dynamic_parameters).length);

    // Simple debug - write to a file since console.log isn't showing
    const debugInfo = {
      timestamp: new Date().toISOString(),
      received_dynamic_parameters: dynamic_parameters,
      parameter_count: Object.keys(dynamic_parameters).length
    };
    fs.writeFileSync('/tmp/batch_debug.json', JSON.stringify(debugInfo, null, 2));

    // If no dynamic parameters, treat it as a single execution with only static parameters
    // This allows the batch-execute endpoint to handle both single and batch executions
    const isSingleExecution = Object.keys(dynamic_parameters).length === 0;
    
    // Generate all unique parameter combinations
    const combinations = isSingleExecution ? [{}] : getCombinations(dynamic_parameters);
    
    console.log('🎯 BATCH EXECUTE: Generated combinations:', combinations.length);
    console.log('📋 BATCH EXECUTE: Combination details:', JSON.stringify(combinations, null, 2));
    
    // Write combination results to debug file
    const combinationDebug = {
      timestamp: new Date().toISOString(),
      generated_combinations: combinations.length,
      combination_details: combinations
    };
    fs.appendFileSync('/tmp/batch_debug.json', '\n' + JSON.stringify(combinationDebug, null, 2));
    
    const totalJobs = combinations.length;
    console.log('🔢 BATCH EXECUTE: Total jobs to create:', totalJobs);
    
    // Cap the number of jobs to prevent abuse
    if (totalJobs > 500) {
        return NextResponse.json(
            { success: false, error: `Batch size (${totalJobs}) exceeds the limit of 500.` },
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

    const batch_id = `batch-${uuidv4()}`;
    const jobsToInsert = [];

    for (const combo of combinations) {
      // Create the final parameters for this specific job
      const finalParams = JSON.parse(JSON.stringify(static_parameters));
      for (const key in combo) {
        set(finalParams, key, combo[key]);
      }
      
      jobsToInsert.push({
        workflow_id: workflowIdNum,
        status: 'queued',
        execution_params: finalParams,
        batch_id: batch_id,
        client_id: `batch-run-${batch_id}`
      });
    }

    console.log('💾 BATCH EXECUTE: Inserting jobs into database...');
    console.log('📝 BATCH EXECUTE: Jobs to insert:', jobsToInsert.length);
    
    // Insert all jobs in a single query
    const { data: insertedJobs, error } = await supabase
      .from('workflow_executions')
      .insert(jobsToInsert)
      .select('id');

    if (error) {
      console.error('❌ BATCH EXECUTE: Database insertion error:', error);
      throw error;
    }

    console.log('✅ BATCH EXECUTE: Successfully inserted jobs');
    console.log('🎯 BATCH EXECUTE: Execution IDs:', insertedJobs.map(j => j.id));

    return NextResponse.json({
      success: true,
      message: `Successfully queued ${totalJobs} workflow execution${totalJobs === 1 ? '' : 's'}.`,
      batch_id: batch_id,
      execution_ids: insertedJobs.map(j => j.id),
    });

  } catch (error) {
    console.error('❌ Error creating batch workflow execution:', error);
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
