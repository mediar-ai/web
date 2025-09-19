import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/workflows/[workflowId]/duplicate - Duplicate an existing workflow
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
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

    const { workflowId: workflowIdStr } = await params;
    const workflowId = parseInt(workflowIdStr);
    if (isNaN(workflowId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    // Optional: accept custom name and description in request body
    const body = await request.json().catch(() => ({}));
    const customName = body.name;
    const customDescription = body.description;

    console.log(`🔄 Duplicating workflow ID: ${workflowId}`);

    // Fetch the original workflow
    const { data: originalWorkflow, error: fetchError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();

    if (fetchError || !originalWorkflow) {
      console.error('❌ Error fetching original workflow:', fetchError);
      return NextResponse.json(
        {
          success: false,
          error: `Workflow not found: ${fetchError?.message || 'Unknown error'}`,
        },
        { status: 404 }
      );
    }

    // Fetch the active version of the original workflow
    const { data: activeVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('is_active', true)
      .single();

    if (versionError || !activeVersion) {
      console.error('❌ Error fetching active version:', versionError);
      return NextResponse.json(
        {
          success: false,
          error: `Active version not found: ${versionError?.message || 'Unknown error'}`,
        },
        { status: 404 }
      );
    }

    // Use custom name if provided, otherwise generate a unique name
    let duplicateName: string;

    if (customName && customName.trim()) {
      // User provided a custom name, use it directly
      duplicateName = customName.trim();

      // Check if this exact name already exists
      const { data: existing } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('name', duplicateName)
        .single();

      if (existing) {
        return NextResponse.json(
          { success: false, error: 'A workflow with this name already exists' },
          { status: 400 }
        );
      }
    } else {
      // No custom name, generate one with (Copy) suffix
      const baseName = originalWorkflow.name;
      duplicateName = `${baseName} (Copy)`;
      let counter = 1;

      // Check for existing duplicates and find a unique name
      while (true) {
        const { data: existing } = await supabase
          .from('deployed_workflows')
          .select('id')
          .eq('name', duplicateName)
          .single();

        if (!existing) break;

        counter++;
        duplicateName = `${baseName} (Copy ${counter})`;
      }
    }

    // Create the duplicate workflow
    const duplicateWorkflowData = {
      name: duplicateName,
      description: customDescription || `${originalWorkflow.description || ''} (Duplicated from ${originalWorkflow.name})`,
      version: '1.0.0',
      status: 'deployed',
      workflow_type: originalWorkflow.workflow_type || 'execution',
      parent_workflow_id: originalWorkflow.parent_workflow_id,
      automation_sequence: activeVersion.automation_sequence,
      estimated_duration_seconds: originalWorkflow.estimated_duration_seconds,
      // Reset cron settings for duplicate (user can enable later)
      cron_expression: originalWorkflow.cron_expression,
      cron_timezone: originalWorkflow.cron_timezone || 'UTC',
      cron_enabled: false, // Disable cron by default for duplicates
      cron_max_concurrent: originalWorkflow.cron_max_concurrent || 1,
      cron_retry_on_failure: originalWorkflow.cron_retry_on_failure !== false,
      cron_retry_count: originalWorkflow.cron_retry_count || 3,
      // Metadata
      created_by: null, // Clerk user IDs are not compatible with UUID format
      total_versions: 1,
    };

    // Insert duplicate workflow
    const { data: newWorkflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .insert(duplicateWorkflowData)
      .select()
      .single();

    if (workflowError) {
      console.error('❌ Error creating duplicate workflow:', workflowError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to duplicate workflow: ${workflowError.message}`,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created duplicate workflow with ID: ${newWorkflow.id}`);

    // Create the initial version for the duplicate
    const duplicateVersionData = {
      workflow_id: newWorkflow.id,
      version_number: '1.0.0',
      automation_sequence_yaml: activeVersion.automation_sequence_yaml,
      automation_sequence: activeVersion.automation_sequence,
      preferred_format: activeVersion.preferred_format || 'yaml',
      is_active: true,
      change_notes: `Duplicated from workflow "${originalWorkflow.name}" (ID: ${workflowId})`,
    };

    const { data: newVersion, error: versionError2 } = await supabase
      .from('deployed_workflow_versions')
      .insert(duplicateVersionData)
      .select()
      .single();

    if (versionError2) {
      console.error('❌ Error creating duplicate version:', versionError2);
      // Try to clean up the workflow if version creation failed
      await supabase
        .from('deployed_workflows')
        .delete()
        .eq('id', newWorkflow.id);

      return NextResponse.json(
        {
          success: false,
          error: `Failed to create duplicate workflow version: ${versionError2.message}`,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created duplicate version: ${newVersion.version_number}`);

    // If the original workflow has settings workflows, we can optionally duplicate those too
    // For now, we'll skip this to keep it simple

    // Return the complete duplicate workflow data
    const response = {
      success: true,
      workflow: {
        ...newWorkflow,
        version_info: newVersion,
      },
      message: `Successfully duplicated workflow as "${duplicateName}"`,
      original_workflow_id: workflowId,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('❌ Workflow duplication error:', error);
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