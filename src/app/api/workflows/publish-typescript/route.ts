/**
 * API Route: POST /api/workflows/publish-typescript
 *
 * Publishes a TypeScript workflow from the desktop app to the cloud.
 * Uses folder_id (UUID) as the canonical identifier via github_folder column.
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
  folder_id: string; // UUID - used as github_folder in database
  name: string;
  description?: string;
  terminator_ts: string; // Content of src/terminator.ts
  files: { path: string; content: string }[]; // All TS files
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
    const { folder_id, name, description, terminator_ts } = body;

    if (!folder_id || !name || !terminator_ts) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: folder_id, name, terminator_ts' },
        { status: 400 }
      );
    }

    const userIdentifier = email || userId || 'desktop-user';
    console.log(`📤 Publishing TypeScript workflow "${name}" (folder: ${folder_id}) for org: ${effectiveOrgId}`);

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

    // Look up existing workflow by github_folder (UUID)
    const { data: existingWorkflow } = await supabase
      .from('deployed_workflows')
      .select('id, organization_id')
      .eq('github_folder', folder_id)
      .single();

    let workflowId: number;

    if (existingWorkflow) {
      // Verify ownership
      if (existingWorkflow.organization_id !== effectiveOrgId) {
        return NextResponse.json(
          { success: false, error: 'Not authorized to update this workflow' },
          { status: 403 }
        );
      }

      workflowId = existingWorkflow.id;
      console.log(`🔄 Updating existing workflow ID: ${workflowId}`);

      // Update workflow metadata including step_count from typescript metadata
      await supabase
        .from('deployed_workflows')
        .update({
          name,
          description: description || metadata.description,
          step_count: metadata.steps?.length || 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', workflowId);

    } else {
      // Create new workflow
      console.log(`🆕 Creating new workflow: "${name}" with github_folder: ${folder_id}`);

      const { data: newWorkflow, error: createError } = await supabase
        .from('deployed_workflows')
        .insert({
          name,
          description: description || metadata.description,
          organization_id: effectiveOrgId,
          created_by: userIdentifier,
          github_folder: folder_id, // UUID - canonical identifier
          workflow_type: 'execution',
          status: 'draft',
          step_count: metadata.steps?.length || 0,
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

    const { error: versionError } = await supabase
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
      });

    if (versionError) {
      console.error('❌ Version creation failed:', versionError);
      return NextResponse.json(
        { success: false, error: `Version creation failed: ${versionError.message}` },
        { status: 500 }
      );
    }

    console.log(`✅ Published TypeScript workflow: ID=${workflowId}, version=${newVersionNumber} (draft - activate from dashboard)`);

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
