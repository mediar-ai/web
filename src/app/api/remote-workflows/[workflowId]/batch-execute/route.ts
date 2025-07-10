import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

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

// Helper to generate the Cartesian product of the dynamic parameters
const getCombinations = (dynamicParams: Record<string, JsonValue[]>) : JsonObject[] => {
  const keys = Object.keys(dynamicParams);
  if (keys.length === 0) return [{}];

  const result: JsonObject[] = [];
  const firstKey = keys[0];
  const firstValues = dynamicParams[firstKey];
  const remainingParams = { ...dynamicParams };
  delete remainingParams[firstKey];

  const remainingCombinations = getCombinations(remainingParams);

  for (const value of firstValues) {
    for (const combination of remainingCombinations) {
      result.push({
        [firstKey]: value,
        ...combination,
      });
    }
  }

  return result;
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

    // If no dynamic parameters, treat it as a single execution with only static parameters
    // This allows the batch-execute endpoint to handle both single and batch executions
    const isSingleExecution = Object.keys(dynamic_parameters).length === 0;
    
    // Generate all unique parameter combinations
    const combinations = isSingleExecution ? [{}] : getCombinations(dynamic_parameters);
    const totalJobs = combinations.length;
    
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

    // Insert all jobs in a single query
    const { data: insertedJobs, error } = await supabase
      .from('workflow_executions')
      .insert(jobsToInsert)
      .select('id');

    if (error) {
      throw error;
    }

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
