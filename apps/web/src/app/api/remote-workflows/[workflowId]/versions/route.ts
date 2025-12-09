import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import * as yaml from 'js-yaml';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkflowId } from '@/lib/workflow-id-resolver';

// Security validation removed - workflows are trusted content uploaded by authenticated users

interface WorkflowVersion {
  version_id: number;
  version_number: string;
  is_active: boolean;
  created_at: string;
  change_notes: string;
  execution_count: number;
}

// GET /api/remote-workflows/[workflowId]/versions - List all versions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to /api/remote-workflows/*/versions');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, description, total_versions, current_version_id, created_by, organization_id'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow organization admins only for write operations
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

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can see all workflows)
    // - User is the workflow owner
    // - User is in the same org (organization_id field) - supports desktop users
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !isSameOrg && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isSameOrg: ${isSameOrg}) attempted unauthorized access to workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    // Get version history with execution counts
    console.log(`📋 Fetching version history for workflow ${workflowIdNum}...`);
    let versionsList: WorkflowVersion[] = [];

    const { data: versions, error: versionsError } = await supabase
      .rpc('get_workflow_version_history', { p_workflow_id: workflowIdNum });

    if (versionsError) {
      console.error(`❌ RPC failed: ${versionsError.message}`);
      console.error('   Full error:', JSON.stringify(versionsError, null, 2));

      // Fallback: Query table directly if RPC doesn't exist
      console.log('🔄 Falling back to direct table query...');
      const { data: directVersions, error: directError } = await supabase
        .from('deployed_workflow_versions')
        .select('id, version_number, is_active, created_at, change_notes')
        .eq('workflow_id', workflowIdNum)
        .order('created_at', { ascending: false });

      if (directError) {
        console.error(`❌ Direct query also failed: ${directError.message}`);
        throw new Error(`Failed to get version history: ${versionsError.message}`);
      }

      console.log(`✅ Direct query returned ${directVersions?.length || 0} versions`);
      versionsList = (directVersions || []).map(v => ({
        version_id: v.id,
        version_number: v.version_number,
        is_active: v.is_active,
        created_at: v.created_at,
        change_notes: v.change_notes || '',
        execution_count: 0 // Can't get execution count without RPC
      }));
    } else {
      console.log(`✅ Fetched ${versions?.length || 0} versions from RPC`);
      versionsList = (versions as WorkflowVersion[]) || [];
    }

    // Format response
    const response = {
      success: true,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        total_versions: workflow.total_versions,
        current_version_id: workflow.current_version_id
      },
      versions: versionsList,
      metadata: {
        total_versions: versionsList.length,
        active_version: versionsList.find((v: WorkflowVersion) => v.is_active)?.version_number,
        generated_at: new Date().toISOString()
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[ERROR] Error listing workflow versions:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflow versions',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// POST /api/remote-workflows/[workflowId]/versions - Create new version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate (support both desktop Bearer tokens and Clerk sessions)
    let authenticatedUserId: string | null = null;
    let orgId: string | null | undefined = null;
    let userEmail: string | null = null;
    let has: any = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import('@/lib/auth/validateDesktopToken');
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
        orgId = validation.orgId;
        userEmail = validation.email || null;
        has = () => false; // Desktop auth doesn't support Clerk role checks
        console.log(`[Desktop Auth] Workflow version creation authenticated for user: ${validation.email}`);
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
      orgId = clerkAuth.orgId;
      has = clerkAuth.has;
      // Get email from session claims if available
      userEmail = clerkAuth.sessionClaims?.email as string || null;
    }

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to create workflow version');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const body = await request.json();
    const { automation_sequence, version_number, change_notes, set_as_active = false } = body;

    console.log('[DEBUG] Received request body keys:', Object.keys(body));
    console.log('[DEBUG] automation_sequence type:', typeof automation_sequence);
    console.log('[DEBUG] automation_sequence length:', automation_sequence?.length);
    console.log('[DEBUG] automation_sequence preview:', automation_sequence?.substring?.(0, 100));

    if (!automation_sequence) {
      console.error('[ERROR] automation_sequence is missing or empty');
      return NextResponse.json(
        { success: false, error: 'automation_sequence is required' },
        { status: 400 }
      );
    }

    // Server-side file size validation
    if (typeof automation_sequence === 'string') {
      const sizeInBytes = Buffer.byteLength(automation_sequence, 'utf8');
      const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB

      if (sizeInBytes > MAX_CONTENT_SIZE) {
        return NextResponse.json(
          {
            success: false,
            error: 'Content exceeds 5MB limit',
            details: `Content size: ${(sizeInBytes / 1024 / 1024).toFixed(2)}MB`
          },
          { status: 413 } // Payload Too Large
        );
      }

      // Binary content detection
      const trimmed = automation_sequence.trim();
      const hasBinaryMarkers = /[\x00-\x08\x0B-\x0C\x0E-\x1F]/.test(trimmed.substring(0, 1000));

      if (hasBinaryMarkers) {
        return NextResponse.json(
          { success: false, error: 'Invalid content format - binary data detected' },
          { status: 400 }
        );
      }

      // Security validation removed - workflows are trusted content
    }

    // Helper function to detect sequence format
    function detectSequenceFormat(content: string): 'yaml' | 'json' {
      const trimmed = content.trim();
      
      // JSON detection
      if ((trimmed.startsWith('[') && trimmed.endsWith(']')) ||
          (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        return 'json';
      }
      
      // YAML detection
      if (trimmed.includes('tool_name:') || trimmed.includes('arguments:') || trimmed.includes(':\n')) {
        return 'yaml';
      }
      
      return 'yaml'; // Default to YAML for new uploads
    }

    // Process automation sequence for dual-format storage - store original format
    let yamlContent: string | null = null;
    let jsonbContent = null; 
    let sequence_format: string;
    let cronConfig = null;

    if (typeof automation_sequence === 'string') {
      // Raw YAML or JSON string - detect and store as-is
      const detectedFormat = detectSequenceFormat(automation_sequence);
      if (detectedFormat === 'yaml') {
        yamlContent = automation_sequence;
        sequence_format = 'yaml';
        
        // Extract cron configuration from YAML
        try {
          const { extractCronConfigFromYAML } = await import('@/lib/cronParser');
          cronConfig = extractCronConfigFromYAML(automation_sequence);
          if (cronConfig) {
            console.log(`📅 Extracted cron config: ${cronConfig.expression} (${cronConfig.timezone})`);
          }
        } catch (error) {
          console.warn('⚠️  Failed to extract cron config from YAML:', error);
        }
        
        // [FIX] FIX: Convert YAML to JSON for automation_sequence column (NOT NULL constraint)
        try {
          jsonbContent = yaml.load(automation_sequence);
        } catch (error) {
          const yamlError = error instanceof Error ? error : new Error('Unknown YAML parsing error');
          return NextResponse.json(
            { success: false, error: `Invalid YAML format: ${yamlError.message}` },
            { status: 400 }
          );
        }
      } else if (detectedFormat === 'json') {
        // Store JSON in JSONB column, no YAML conversion
        try {
          jsonbContent = JSON.parse(automation_sequence);
          sequence_format = 'jsonb';
        } catch (error) {
          const jsonError = error instanceof Error ? error : new Error('Unknown JSON parsing error');
          return NextResponse.json(
            { success: false, error: `Invalid JSON format: ${jsonError.message}` },
            { status: 400 }
          );
        }
        // No YAML storage for JSON uploads
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid content format. Please use valid JSON or YAML.' },
          { status: 400 }
        );
      }
    } else if (typeof automation_sequence === 'object') {
      // JavaScript object from UI - store in JSONB
      jsonbContent = automation_sequence;
      sequence_format = 'jsonb';
      // No YAML storage for object uploads
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid automation_sequence format' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, version, total_versions, created_by, organization_id, is_public'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg: isMediarOrgPost, isMediarAdmin: isMediarAdminPost } = await getEffectiveOrgId(null);

    // Prevent modification of public workflows (is_public = true) by non-Mediar users
    if (workflow.is_public && !isMediarOrgPost && !isMediarAdminPost) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} attempted to create version for public workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - Public workflows can only be modified by Mediar administrators' },
        { status: 403 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Creating versions requires write or admin access level
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('access_level')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      // Only 'write' or 'admin' access levels can create versions
      hasOrgAccess = !!orgAccess && ['write', 'admin'].includes(orgAccess.access_level);
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify all workflows)
    // - User is the workflow owner
    // - User is in the same org (organization_id field) - supports desktop users
    // - User's organization has write/admin access via workflow_organization_access table
    if (!isMediarOrgPost && !isMediarAdminPost && !isOwner && !isSameOrg && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isSameOrg: ${isSameOrg}) attempted unauthorized version creation for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    // Generate next version number if not provided
    let newVersionNumber = version_number;
    if (!newVersionNumber) {
      // [FIX] Auto-increment from LATEST version in DB
      // Use limit(1) instead of single() to avoid errors with zero/multiple rows
      const { data: latestVersions, error: latestVersionError } = await supabase
        .from('deployed_workflow_versions')
        .select('version_number')
        .eq('workflow_id', workflowIdNum)
        .order('created_at', { ascending: false })  // Use created_at for reliable ordering
        .limit(1);

      let baseVersion = workflow.version; // fallback to active version

      if (latestVersionError) {
        console.error(`[ERROR] Failed to fetch latest version:`, latestVersionError);
        console.log(`[FALLBACK] Using active version ${baseVersion} for increment`);
      } else if (latestVersions && latestVersions.length > 0) {
        baseVersion = latestVersions[0].version_number;
        console.log(`[SUCCESS] Using latest DB version ${baseVersion} (instead of active ${workflow.version}) for increment`);
      } else {
        console.log(`[INFO] No versions found in DB, using active version ${baseVersion} for increment`);
      }

      const { data: incrementResult, error: incrementError } = await supabase
        .rpc('increment_version', { version_text: baseVersion });

      if (incrementError) {
        throw new Error(`Failed to generate version number: ${incrementError.message}`);
      }

      newVersionNumber = incrementResult;
      console.log(`[VERSION] Generated ${newVersionNumber} (incremented from ${baseVersion})`);
    }

    // Check if version already exists
    const { data: existingVersion } = await supabase
      .from('deployed_workflow_versions')
      .select('id')
      .eq('workflow_id', workflowIdNum)
      .eq('version_number', newVersionNumber)
      .single();

    if (existingVersion) {
      return NextResponse.json(
        { success: false, error: `Version ${newVersionNumber} already exists` },
        { status: 409 }
      );
    }

    // Create new version - store in original format only
    const versionData = {
      workflow_id: workflowIdNum,
      version_number: newVersionNumber,
      automation_sequence_yaml: yamlContent,     // YAML content (null for JSON uploads)
      automation_sequence: jsonbContent,         // JSONB content (null for YAML uploads)
      preferred_format: sequence_format,
      is_active: false, // Don't activate immediately
      change_notes: change_notes || `Version ${newVersionNumber} created via API (${sequence_format} format)`
    };

    // Update parent workflow with cron configuration if present
    const currentTotalVersions = (workflow.total_versions as number) || 0;
    const workflowUpdateData: any = {
      total_versions: currentTotalVersions + 1,
      updated_at: new Date().toISOString()
    };

    if (cronConfig) {
      workflowUpdateData.cron_expression = cronConfig.expression;
      workflowUpdateData.cron_timezone = cronConfig.timezone || 'UTC';
      workflowUpdateData.cron_enabled = cronConfig.enabled !== false;
      workflowUpdateData.cron_max_concurrent = cronConfig.maxConcurrent || 1;
      workflowUpdateData.cron_retry_on_failure = cronConfig.retryOnFailure !== false;
      workflowUpdateData.cron_retry_count = cronConfig.retryCount || 3;
      console.log(`📅 Updating workflow cron settings: ${cronConfig.expression}`);
    }

    const { data: newVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .insert(versionData)
      .select()
      .single();

    if (versionError) {
      throw new Error(`Failed to create version: ${versionError.message}`);
    }

    // Update workflow metadata (including cron config if present)
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update(workflowUpdateData)
      .eq('id', workflowIdNum);

    if (updateError) {
      throw new Error(`Failed to update workflow metadata: ${updateError.message}`);
    }

    // Activate new version if requested
    if (set_as_active) {
      const { error: activateError } = await supabase
        .rpc('activate_workflow_version', {
          p_workflow_id: workflowIdNum,
          p_version_number: newVersionNumber
        });

      if (activateError) {
        throw new Error(`Failed to activate version: ${activateError.message}`);
      }
    }

    // Push to GitHub if YAML format (fire-and-forget for faster response)
    if (yamlContent) {
      const { githubWorkflowManager } = await import('@/lib/github-workflow-manager');
      console.log(`📤 Pushing version ${newVersionNumber} to GitHub (async)...`);

      // Fire-and-forget: don't await GitHub sync
      githubWorkflowManager.saveWorkflow(
        workflow.name,
        yamlContent,
        false, // Not development
        `Update workflow: ${workflow.name} (v${newVersionNumber})`,
        false, // Don't create PR - push directly
        workflowIdNum,
        orgId || undefined,
        { email: userEmail || undefined }
      ).then(async (result) => {
        if (result.success) {
          console.log(`✅ Pushed to GitHub: ${result.path}`);
          await supabase
            .from('github_workflow_sync_log')
            .insert({
              workflow_id: workflowIdNum,
              operation: 'push',
              github_path: result.path,
              github_sha: result.sha,
              status: 'success'
            });
        } else {
          console.warn(`⚠️ GitHub push failed: ${result.error}`);
        }
      }).catch((error) => {
        console.error('GitHub sync error:', error);
      });
    }

    const response = {
      success: true,
      message: `Version ${newVersionNumber} created successfully`,
      version: {
        id: newVersion.id,
        version_number: newVersionNumber,
        workflow_id: workflowIdNum,
        is_active: set_as_active,
        change_notes: newVersion.change_notes,
        created_at: newVersion.created_at
      },
      workflow: {
        id: workflowIdNum,
        name: workflow.name,
        total_versions: currentTotalVersions + 1,
        current_version: set_as_active ? newVersionNumber : workflow.version
      },
      github_sync: 'async' // GitHub sync is fire-and-forget for faster response
    };

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('[ERROR] Error creating workflow version:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create workflow version',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 