import { extractCronConfigFromYAML } from '@/lib/cronParser';
import { createClient } from '@supabase/supabase-js';
import * as yaml from 'js-yaml';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface CreateWorkflowRequest {
  name: string;
  description?: string;
  category?: string;
  workflow_type?: 'execution' | 'settings';
  parent_workflow_id?: number;
  automation_sequence: string; // YAML or JSON string
  input_parameters?: Record<string, any>;
  expected_outputs?: Record<string, any>;
  sample_inputs?: Record<string, any>;
  estimated_duration_seconds?: number;
  difficulty_level?: 'easy' | 'medium' | 'hard' | 'expert';
  tags?: string[];
  set_as_active?: boolean;
}

/**
 * POST /api/workflows/create - Create a brand new workflow from scratch
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: CreateWorkflowRequest = await request.json();
    
    // Validate required fields
    if (!body.name || !body.automation_sequence) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Missing required fields: name and automation_sequence are required' 
        },
        { status: 400 }
      );
    }

    console.log(`🚀 Creating new workflow: ${body.name}`);

    // Detect and parse automation sequence format
    function detectSequenceFormat(content: string): 'yaml' | 'json' {
      const trimmed = content.trim();
      
      // JSON detection
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        return 'json';
      }
      
      // YAML detection - more comprehensive
      if (trimmed.includes('tool_name:') || 
          trimmed.includes('arguments:') || 
          trimmed.includes('cron:') ||
          trimmed.includes('steps:') ||
          trimmed.startsWith('---')) {
        return 'yaml';
      }
      
      return 'yaml'; // Default to YAML
    }

    const sequenceFormat = detectSequenceFormat(body.automation_sequence);
    console.log(`📄 Detected format: ${sequenceFormat}`);

    // Parse automation sequence and extract cron config
    let parsedSequence;
    let cronConfig = null;
    let yamlContent: string | null = null;
    let jsonbContent = null;

    try {
      if (sequenceFormat === 'yaml') {
        yamlContent = body.automation_sequence;
        parsedSequence = yaml.load(body.automation_sequence);
        
        // Extract cron configuration
        cronConfig = extractCronConfigFromYAML(body.automation_sequence);
        if (cronConfig) {
          console.log(`📅 Extracted cron config: ${cronConfig.expression}`);
        }
      } else {
        jsonbContent = JSON.parse(body.automation_sequence);
        parsedSequence = jsonbContent;
      }
    } catch (parseError) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Invalid ${sequenceFormat} format: ${parseError instanceof Error ? parseError.message : 'Parse error'}` 
        },
        { status: 400 }
      );
    }

    // Input parameters are now stored within the automation sequence itself

    // Create the main workflow record
    const workflowData = {
      name: body.name,
      description: body.description || '',
      version: '1.0.0',
      status: 'deployed',
      workflow_type: body.workflow_type || 'execution',
      parent_workflow_id: body.parent_workflow_id || null,
      automation_sequence: jsonbContent || parsedSequence, // JSONB column (required)
      estimated_duration_seconds: body.estimated_duration_seconds,
      // Cron configuration
      cron_expression: cronConfig?.expression || null,
      cron_timezone: cronConfig?.timezone || 'UTC',
      cron_enabled: cronConfig?.enabled || false,
      cron_max_concurrent: cronConfig?.maxConcurrent || 1,
      cron_retry_on_failure: cronConfig?.retryOnFailure !== false,
      cron_retry_count: cronConfig?.retryCount || 3,
      // Metadata  
      created_by: null, // Clerk user IDs are not compatible with UUID format
      total_versions: 1
    };

    // Insert main workflow
    const { data: newWorkflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .insert(workflowData)
      .select()
      .single();

    if (workflowError) {
      console.error('❌ Error creating workflow:', workflowError);
      return NextResponse.json(
        { 
          success: false, 
          error: `Failed to create workflow: ${workflowError.message}` 
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created workflow with ID: ${newWorkflow.id}`);

    // Create the initial version record
    const versionData = {
      workflow_id: newWorkflow.id,
      version_number: '1.0.0',
      automation_sequence_yaml: yamlContent,
      automation_sequence: jsonbContent || parsedSequence,
      preferred_format: sequenceFormat,
      is_active: body.set_as_active !== false, // Default to active
      change_notes: 'Initial version created via UI'
    };

    const { data: newVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .insert(versionData)
      .select()
      .single();

    if (versionError) {
      console.error('❌ Error creating version:', versionError);
      // Try to clean up the workflow if version creation failed
      await supabase.from('deployed_workflows').delete().eq('id', newWorkflow.id);
      
      return NextResponse.json(
        { 
          success: false, 
          error: `Failed to create workflow version: ${versionError.message}` 
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created version: ${newVersion.version_number}`);

    // Return the complete workflow data
    const response = {
      success: true,
      workflow: {
        ...newWorkflow,
        version_info: newVersion,
        cron_config: cronConfig
      },
      message: `Workflow "${body.name}" created successfully with version ${newVersion.version_number}`
    };

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('❌ Workflow creation error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/workflows/create - Get workflow creation templates and examples
 */
export async function GET() {
  try {
    const templates = {
      basic_automation: {
        name: "Basic Automation Template",
        description: "Simple automation workflow template",
        automation_sequence: `---
tool_name: execute_sequence
arguments:
  variables:
    target_url:
      type: string
      label: Target URL
      description: The URL to navigate to
      default: "https://example.com"
  
  inputs:
    target_url: "https://example.com"
  
  steps:
    - tool_name: navigate_browser
      arguments:
        url: "\${{target_url}}"
    
    - tool_name: get_focused_window_tree
      arguments: {}`,
        category: "web_automation",
        difficulty_level: "easy",
        estimated_duration_seconds: 30
      },
      
      cron_scheduled: {
        name: "Scheduled Task Template",
        description: "Template for scheduled/cron workflows",
        automation_sequence: `---
# Runs every 5 minutes
cron: "0 */5 * * * *"
timezone: "UTC"
enabled: true

tool_name: execute_sequence
arguments:
  steps:
    - tool_name: run_command
      arguments:
        unix_command: "echo 'Scheduled task executed at \$(date)'"
    
    - tool_name: run_command
      arguments:
        unix_command: "echo 'Task completed successfully'"`,
        category: "scheduled_tasks",
        difficulty_level: "easy",
        estimated_duration_seconds: 10
      },
      
      form_automation: {
        name: "Form Automation Template", 
        description: "Template for filling out forms and extracting data",
        automation_sequence: `---
tool_name: execute_sequence
arguments:
  variables:
    form_url:
      type: string
      label: Form URL
      description: URL of the form to fill
      default: "https://example.com/form"
    
    name_value:
      type: string
      label: Name
      description: Name to enter in the form
      default: "John Doe"
  
  inputs:
    form_url: "https://example.com/form"
    name_value: "John Doe"
  
  selectors:
    name_field: "role:Edit|name:Name"
    submit_button: "role:Button|name:Submit"
  
  steps:
    - tool_name: navigate_browser
      arguments:
        url: "\${{form_url}}"
    
    - tool_name: set_value
      arguments:
        selector: "\${{selectors.name_field}}"
        value: "\${{name_value}}"
    
    - tool_name: click_element
      arguments:
        selector: "\${{selectors.submit_button}}"`,
        category: "form_automation",
        difficulty_level: "medium",
        estimated_duration_seconds: 60
      }
    };

    return NextResponse.json({
      success: true,
      templates,
      categories: [
        'web_automation',
        'form_automation', 
        'data_extraction',
        'scheduled_tasks',
        'system_monitoring',
        'api_testing',
        'general'
      ],
      difficulty_levels: ['easy', 'medium', 'hard', 'expert']
    });

  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}
