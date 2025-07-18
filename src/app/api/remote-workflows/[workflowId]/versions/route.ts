import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as yaml from 'js-yaml';

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
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get workflow info
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, description, total_versions, current_version_id')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Get version history with execution counts
    const { data: versions, error: versionsError } = await supabase
      .rpc('get_workflow_version_history', { p_workflow_id: workflowIdNum });

    if (versionsError) {
      throw new Error(`Failed to get version history: ${versionsError.message}`);
    }

    const versionsList = (versions as WorkflowVersion[]) || [];

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
    console.error('❌ Error listing workflow versions:', error);
    
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
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    const body = await request.json();
    const { automation_sequence, version_number, change_notes, set_as_active = false } = body;

    if (!automation_sequence) {
      return NextResponse.json(
        { success: false, error: 'automation_sequence is required' },
        { status: 400 }
      );
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

    if (typeof automation_sequence === 'string') {
      // Raw YAML or JSON string - detect and store as-is
      const detectedFormat = detectSequenceFormat(automation_sequence);
      if (detectedFormat === 'yaml') {
        yamlContent = automation_sequence;
        sequence_format = 'yaml';
        // 🔧 FIX: Convert YAML to JSON for automation_sequence column (NOT NULL constraint)
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify workflow exists
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, version, total_versions')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Generate next version number if not provided
    let newVersionNumber = version_number;
    if (!newVersionNumber) {
      // 🔧 FIX: Auto-increment from LATEST version in DB, not active version
      // This prevents version collisions when multiple uploads happen before activation
      const { data: latestVersion, error: latestVersionError } = await supabase
        .from('deployed_workflow_versions')
        .select('version_number')
        .eq('workflow_id', workflowIdNum)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();
      
      let baseVersion = workflow.version; // fallback to active version
      if (latestVersion && !latestVersionError) {
        baseVersion = latestVersion.version_number;
        console.log(`🔧 Using latest DB version ${baseVersion} instead of active ${workflow.version} for increment`);
      } else {
        console.log(`⚠️ No versions found in DB, using active version ${baseVersion} for increment`);
      }
      
      const { data: incrementResult, error: incrementError } = await supabase
        .rpc('increment_version', { version_text: baseVersion });
      
      if (incrementError) {
        throw new Error(`Failed to generate version number: ${incrementError.message}`);
      }
      
      newVersionNumber = incrementResult;
      console.log(`✅ Generated version number: ${newVersionNumber} (incremented from ${baseVersion})`);
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

    const { data: newVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .insert(versionData)
      .select()
      .single();

    if (versionError) {
      throw new Error(`Failed to create version: ${versionError.message}`);
    }

    // Update workflow metadata
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        total_versions: workflow.total_versions + 1,
        updated_at: new Date().toISOString()
      })
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
        total_versions: workflow.total_versions + 1,
        current_version: set_as_active ? newVersionNumber : workflow.version
      }
    };

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('❌ Error creating workflow version:', error);
    
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