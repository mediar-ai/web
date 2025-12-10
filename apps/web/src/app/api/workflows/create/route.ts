import { extractCronConfigFromYAML } from '@/lib/cronParser';
import { validateWorkflowOutputParser } from '@/lib/workflow-validation';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
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
    // Check authentication and organization using unified auth helper
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');

    // Get effective organization (handles both desktop tokens and Clerk auth)
    const { orgId: effectiveOrgId, isMediarOrg, isMediarAdmin: _isMediarAdmin, actualOrgId, userId, email } = await getEffectiveOrgId();

    if (!effectiveOrgId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required - no organization context' },
        { status: 401 }
      );
    }

    // Use user info from getEffectiveOrgId (works for both desktop tokens and Clerk auth)
    const userIdentifier = email || userId || 'desktop-user';

    console.log(`🚀 Creating workflow for org: ${effectiveOrgId} (user: ${userIdentifier}, isMediar: ${isMediarOrg})`);

    // Require organization context for workflow creation
    if (!effectiveOrgId) {
      console.error(`[Workflow Create] Rejecting workflow creation - no organization context for user: ${userIdentifier}`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Organization required to create workflows. Please re-authenticate with organization context.',
          details: 'Workflows must belong to an organization for proper access control.'
        },
        { status: 400 }
      );
    }

    const body: CreateWorkflowRequest = await request.json();

    // Validate required fields
    if (!body.name || !body.automation_sequence) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing required fields: name and automation_sequence are required',
        },
        { status: 400 }
      );
    }

    console.log(`🚀 Creating new workflow: ${body.name}`);

    // Detect and parse automation sequence format
    function detectSequenceFormat(content: string): 'yaml' | 'json' {
      const trimmed = content.trim();

      // JSON detection
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        return 'json';
      }

      // YAML detection - more comprehensive
      if (
        trimmed.includes('tool_name:') ||
        trimmed.includes('arguments:') ||
        trimmed.includes('cron:') ||
        trimmed.includes('steps:') ||
        trimmed.startsWith('---')
      ) {
        return 'yaml';
      }

      return 'yaml'; // Default to YAML
    }

    const sequenceFormat = detectSequenceFormat(body.automation_sequence);
    console.log(`📄 Detected format: ${sequenceFormat}`);

    // Parse automation sequence and extract cron config
    let parsedSequence: any;
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

        // Validate output parser format (async)
        const parserValidation = await validateWorkflowOutputParser(
          body.automation_sequence
        );

        if (parserValidation.hasParser) {
          console.log(`🔍 Validating output parser format...`);

          if (parserValidation.parserValidation) {
            const { isValid, errors, warnings, hasStandardFormat } =
              parserValidation.parserValidation;

            // Log validation results
            if (!hasStandardFormat) {
              console.warn(
                `⚠️ Workflow parser may not follow standardized format`
              );
              warnings.forEach(w => console.warn(`  - ${w}`));
            }

            if (!isValid) {
              console.error(`❌ Parser validation errors:`, errors);
              // Note: We don't block creation for backward compatibility
              // but we log warnings for monitoring
            }

            // Add validation metadata to help with debugging
            if (!parsedSequence.metadata) {
              parsedSequence.metadata = {};
            }
            parsedSequence.metadata.parserValidation = {
              hasStandardFormat,
              validationWarnings: warnings,
              validationErrors: errors,
              validatedAt: new Date().toISOString(),
            };
          }
        } else {
          console.log(
            `ℹ️ Workflow has no output parser (will use default behavior)`
          );
        }
      } else {
        jsonbContent = JSON.parse(body.automation_sequence);
        parsedSequence = jsonbContent;
      }
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid ${sequenceFormat} format: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
        },
        { status: 400 }
      );
    }

    // Input parameters are now stored within the automation sequence itself

    // Create the main workflow record with organization ownership
    const workflowData = {
      name: body.name,
      description: body.description || '',
      version: '1.0.0',
      status: 'deployed',
      workflow_type: body.workflow_type || 'execution',
      parent_workflow_id: body.parent_workflow_id || null,
      automation_sequence: jsonbContent || parsedSequence, // JSONB column (required)
      estimated_duration_seconds: body.estimated_duration_seconds,
      // Organization ownership (use effectiveOrgId which falls back to Mediar org)
      organization_id: effectiveOrgId,
      // Cron configuration
      cron_expression: cronConfig?.expression || null,
      cron_timezone: cronConfig?.timezone || 'UTC',
      cron_enabled: cronConfig?.enabled || false,
      cron_max_concurrent: cronConfig?.maxConcurrent || 1,
      cron_retry_on_failure: cronConfig?.retryOnFailure !== false,
      cron_retry_count: cronConfig?.retryCount || 3,
      // Metadata
      created_by: userId || email || null, // Store userId first for consistent ownership checks
      total_versions: 1,
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
          error: `Failed to create workflow: ${workflowError.message}`,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created workflow with ID: ${newWorkflow.id}`);

    // Grant owner organization admin access to the workflow
    if (effectiveOrgId) {
      const { error: accessError } = await supabase
        .from('workflow_organization_access')
        .insert({
          workflow_id: newWorkflow.id,
          organization_id: effectiveOrgId,
          access_level: 'admin',
          granted_at: new Date().toISOString(),
          workflow_uuid: newWorkflow.uuid, // Required for check_org_workflow_access function
        });

      if (accessError) {
        console.error('⚠️ Failed to grant organization access:', accessError);
        // Don't fail the whole creation, but log the issue
      } else {
        console.log(`✅ Granted ${effectiveOrgId} admin access to workflow ${newWorkflow.id}`);
      }
    }

    // Create the initial version record
    const versionData = {
      workflow_id: newWorkflow.id,
      version_number: '1.0.0',
      automation_sequence_yaml: yamlContent,
      automation_sequence: jsonbContent || parsedSequence,
      preferred_format: sequenceFormat,
      is_active: body.set_as_active !== false, // Default to active
      change_notes: 'Initial version created via UI',
    };

    const { data: newVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .insert(versionData)
      .select()
      .single();

    if (versionError) {
      console.error('❌ Error creating version:', versionError);
      // Try to clean up the workflow if version creation failed
      await supabase
        .from('deployed_workflows')
        .delete()
        .eq('id', newWorkflow.id);

      return NextResponse.json(
        {
          success: false,
          error: `Failed to create workflow version: ${versionError.message}`,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created version: ${newVersion.version_number}`);

    // Also save to GitHub for version control (fire-and-forget)
    const isDevelopment = body.workflow_type === 'settings' || body.category === 'development';
    const yamlToSync = yamlContent || yaml.dump(parsedSequence);

    githubWorkflowManager.saveWorkflow(
      body.name,
      yamlToSync,
      isDevelopment,
      `Create workflow: ${body.name}`,
      false,
      newWorkflow.id,
      effectiveOrgId,
      { email: email || undefined }
    ).then(async (result) => {
      if (result.success) {
        console.log(`✅ Saved to GitHub: ${result.path}`);
        if (result.prUrl) {
          console.log(`📝 Created PR: ${result.prUrl}`);
        }
        await supabase
          .from('github_workflow_sync_log')
          .insert({
            workflow_id: newWorkflow.id,
            operation: 'push',
            github_path: result.path,
            github_sha: result.sha,
            status: 'success'
          });
      } else {
        console.warn(`⚠️ GitHub save failed: ${result.error}`);
      }
    }).catch((error) => {
      console.error('GitHub sync error:', error);
    });

    // Return the complete workflow data
    const response = {
      success: true,
      workflow: {
        ...newWorkflow,
        version_info: newVersion,
        cron_config: cronConfig,
      },
      message: `Workflow "${body.name}" created successfully with version ${newVersion.version_number}`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('❌ Workflow creation error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
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
        name: 'Basic Automation Template',
        description: 'Simple automation workflow template',
        automation_sequence: `---
tool_name: execute_sequence
arguments:
  inputs:
    target_url: "https://www.google.com"

  steps:
    - tool_name: navigate_browser
      arguments:
        url: "\${{target_url}}"

    - tool_name: delay
      arguments:
        delay_ms: 2000

  output: |
    // Modern output parser for navigation workflow
    const results = stepResults || [];

    if (!results || results.length === 0) {
      return {
        success: false,
        data: null,
        message: "No navigation results available",
        error: "No results from navigation",
        validation: { resultsAvailable: false }
      };
    }

    const navResult = results[0];
    const success = navResult?.success || navResult?.status === 'success';

    return {
      success: success,
      data: {
        navigationResult: navResult,
        timestamp: new Date().toISOString()
      },
      message: success ? "Successfully navigated to Google" : "Navigation failed",
      error: !success ? navResult?.error || "Navigation error" : null,
      validation: {
        navigationCompleted: !!navResult,
        navigationSuccess: success
      }
    };`,
        category: 'web_automation',
        difficulty_level: 'easy',
        estimated_duration_seconds: 30,
      },

      cron_scheduled: {
        name: 'Scheduled Task Template',
        description: 'Template for scheduled/cron workflows',
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
        engine: "javascript"
        run: |
          // Get current time and system info
          const os = require('os');
          const now = new Date();

          console.log(\`Scheduled task executed at \${now.toISOString()}\`);
          console.log(\`System: \${os.platform()} - \${os.hostname()}\`);
          console.log(\`Uptime: \${Math.floor(os.uptime() / 60)} minutes\`);

          return {
            status: 'success',
            output: \`Scheduled task executed at \${now.toISOString()}\`,
            result: \`Task executed on \${os.hostname()} at \${now.toISOString()}\`
          };

    - tool_name: run_command
      arguments:
        engine: "javascript"
        run: |
          console.log('Task completed successfully');

          return {
            status: 'success',
            output: 'Task completed successfully',
            result: 'All scheduled operations completed'
          };

  output: |
    // Modern output parser for scheduled tasks
    const results = stepResults || [];

    if (!results || results.length === 0) {
      return {
        success: false,
        data: null,
        message: "No execution results available",
        error: "Parser could not access execution results",
        validation: { resultsAvailable: false }
      };
    }

    const validation = {
      firstCommandExecuted: !!results[0],
      secondCommandExecuted: !!results[1],
      allCommandsSuccess: results.every(r => r?.success !== false && r?.status !== 'failed')
    };

    const success = validation.allCommandsSuccess;

    return {
      success: success,
      data: {
        executionTimestamp: new Date().toISOString(),
        commandResults: results,
        totalCommands: results.length
      },
      message: success ? "Scheduled task completed successfully" : "Task failed",
      error: !success ? "One or more commands failed" : null,
      validation: validation
    };`,
        category: 'scheduled_tasks',
        difficulty_level: 'easy',
        estimated_duration_seconds: 10,
      },

      form_automation: {
        name: 'Form Automation Template',
        description: 'Template for filling out forms and extracting data',
        automation_sequence: `---
tool_name: execute_sequence
arguments:
  variables:
    form_url:
      type: string
      label: Form URL
      description: URL of the form to fill
      default: "https://www.google.com"

    name_value:
      type: string
      label: Name
      description: Name to enter in the form
      default: "John Doe"

  inputs:
    form_url: "https://www.google.com"
    name_value: "John Doe"

  selectors:
    name_field: "role:Search"
    submit_button: "role:Button|name:Google Search"

  steps:
    - tool_name: navigate_browser
      arguments:
        url: "\${{form_url}}"

    - tool_name: delay
      arguments:
        delay_ms: 2000

    - tool_name: type_into_element
      arguments:
        selector: "\${{selectors.name_field}}"
        text_to_type: "\${{name_value}}"
        clear_before_typing: true

    - tool_name: press_key
      arguments:
        selector: "\${{selectors.name_field}}"
        key: "{Enter}"

    - tool_name: delay
      arguments:
        delay_ms: 2000

  output: |
    // Modern output parser for form automation
    const results = stepResults || [];

    if (!results || results.length === 0) {
      return {
        success: false,
        data: null,
        message: "No form automation results available",
        error: "No results from form automation",
        validation: { resultsAvailable: false }
      };
    }

    // Check for form submission errors
    const lastResult = results[results.length - 1];
    const hasError = lastResult?.error || lastResult?.status === 'failed';

    // Validation checks
    const validation = {
      formNavigated: !!results[0] && results[0].success !== false,
      fieldTyped: !!results[2] && results[2].success !== false,
      keyPressed: !!results[3] && results[3].success !== false,
      allStepsCompleted: results.length >= 5,
      noErrors: !hasError
    };

    const success = validation.formNavigated &&
                    validation.fieldTyped &&
                    validation.keyPressed &&
                    validation.noErrors;

    // Extract all relevant data
    const data = {
      submittedData: {
        name: "John Doe"
      },
      stepsCompleted: results.length,
      timestamp: new Date().toISOString()
    };

    return {
      success: success,
      data: data,
      message: success
        ? "Form automation completed successfully"
        : "Form automation failed",
      error: hasError ? "Form automation error detected" : null,
      validation: validation
    };`,
        category: 'form_automation',
        difficulty_level: 'medium',
        estimated_duration_seconds: 60,
      },
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
        'general',
      ],
      difficulty_levels: ['easy', 'medium', 'hard', 'expert'],
    });
  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}
