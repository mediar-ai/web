/**
 * API Route: POST /api/workflows/publish-typescript
 *
 * Publishes a TypeScript workflow from the desktop app to the cloud.
 * This endpoint:
 * 1. Receives TypeScript workflow files from desktop app
 * 2. Parses the terminator.ts to extract metadata
 * 3. Creates or updates the workflow in the database
 * 4. Returns the workflow ID for future syncs
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseTypeScriptWorkflow } from '@/lib/typescript-workflow-parser';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PublishRequest {
  folder_id: string; // Local folder ID (e.g., "imperial-treasure-sap-164")
  name: string;
  description?: string;
  terminator_ts: string; // Content of src/terminator.ts
  files: { path: string; content: string }[]; // All TS files
  cloud_workflow_id?: number; // If updating existing cloud workflow
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId: effectiveOrgId, email, userId } = await getEffectiveOrgId();

    if (!effectiveOrgId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: PublishRequest = await request.json();
    const { folder_id, name, description, terminator_ts, files, cloud_workflow_id } = body;

    if (!folder_id || !name || !terminator_ts) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: folder_id, name, terminator_ts' },
        { status: 400 }
      );
    }

    const userIdentifier = email || userId || 'desktop-user';
    console.log(`📤 Publishing TypeScript workflow "${name}" for org: ${effectiveOrgId} (user: ${userIdentifier})`);

    // Parse the TypeScript workflow
    let metadata;
    try {
      metadata = parseTypeScriptWorkflow(terminator_ts);
      console.log(`✅ Parsed TypeScript workflow: ${metadata.steps?.length || 0} steps`);
    } catch (parseError) {
      console.error('❌ Failed to parse TypeScript workflow:', parseError);
      return NextResponse.json(
        { success: false, error: `Failed to parse workflow: ${parseError}` },
        { status: 400 }
      );
    }

    let workflowId = cloud_workflow_id;

    if (workflowId) {
      // Update existing workflow
      console.log(`🔄 Updating existing workflow ID: ${workflowId}`);

      // Verify ownership
      const { data: existingWorkflow, error: fetchError } = await supabase
        .from('deployed_workflows')
        .select('id, organization_id')
        .eq('id', workflowId)
        .single();

      if (fetchError || !existingWorkflow) {
        return NextResponse.json(
          { success: false, error: 'Workflow not found' },
          { status: 404 }
        );
      }

      if (existingWorkflow.organization_id !== effectiveOrgId) {
        return NextResponse.json(
          { success: false, error: 'Not authorized to update this workflow' },
          { status: 403 }
        );
      }

      // Update workflow metadata
      await supabase
        .from('deployed_workflows')
        .update({
          name,
          description: description || metadata.description,
          updated_at: new Date().toISOString(),
        })
        .eq('id', workflowId);

    } else {
      // Create new workflow
      console.log(`🆕 Creating new workflow: "${name}"`);

      const { data: newWorkflow, error: createError } = await supabase
        .from('deployed_workflows')
        .insert({
          name,
          description: description || metadata.description,
          organization_id: effectiveOrgId,
          created_by: userIdentifier,
          github_folder: folder_id, // Store local folder ID for mapping
          workflow_type: 'execution',
          is_active: true,
        })
        .select('id')
        .single();

      if (createError || !newWorkflow) {
        console.error('❌ Failed to create workflow:', createError);
        return NextResponse.json(
          { success: false, error: `Failed to create workflow: ${createError?.message}` },
          { status: 500 }
        );
      }

      workflowId = newWorkflow.id;
      console.log(`✅ Created workflow with ID: ${workflowId}`);
    }

    // Create new version
    const { data: latestVersion } = await supabase
      .from('deployed_workflow_versions')
      .select('version_number')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Increment patch version
    let newVersionNumber = metadata.version || '1.0.0';
    if (latestVersion?.version_number) {
      const parts = latestVersion.version_number.split('.');
      const patch = parseInt(parts[2] || '0') + 1;
      newVersionNumber = `${parts[0]}.${parts[1]}.${patch}`;
    }

    console.log(`📝 Creating version ${newVersionNumber} for workflow ${workflowId}`);

    const { data: newVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .insert({
        workflow_id: workflowId,
        version_number: newVersionNumber,
        automation_sequence: metadata,
        automation_sequence_yaml: null,
        preferred_format: 'typescript',
        typescript_metadata: metadata,
        is_active: false,
        change_notes: 'Published from desktop app',
      })
      .select()
      .single();

    if (versionError) {
      console.error('❌ Version creation failed:', versionError);
      return NextResponse.json(
        { success: false, error: `Version creation failed: ${versionError.message}` },
        { status: 500 }
      );
    }

    // Activate the new version
    const { error: activateError } = await supabase.rpc('activate_workflow_version', {
      p_workflow_id: workflowId,
      p_version_number: newVersionNumber,
    });

    if (activateError) {
      console.error('⚠️ Failed to activate version:', activateError.message);
    }

    console.log(`✅ Published TypeScript workflow: ID=${workflowId}, version=${newVersionNumber}`);

    return NextResponse.json({
      success: true,
      workflow_id: workflowId,
      version: newVersionNumber,
      step_count: metadata.steps?.length || 0,
    });

  } catch (error) {
    console.error('❌ Error publishing TypeScript workflow:', error);
    return NextResponse.json(
      { success: false, error: `Internal error: ${error}` },
      { status: 500 }
    );
  }
}
