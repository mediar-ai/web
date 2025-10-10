import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import yaml from 'js-yaml';

// GET /api/remote-workflows/[workflowId]/steps - Extract step IDs from workflow (YAML or JSONB)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);

    // Get version from query params
    const { searchParams } = new URL(request.url);
    const versionNumber = searchParams.get('version');

    console.log(`🔍 Extracting steps for workflow ${workflowIdNum}${versionNumber ? ` version ${versionNumber}` : ''}`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get workflow data (YAML or JSONB) from database
    let workflowData: any = null;
    let resolvedVersion: string | null = versionNumber;
    let dataSource: 'yaml' | 'jsonb' = 'yaml';

    if (versionNumber) {
      // Get specific version from database (both YAML and JSONB)
      const { data: versionData, error: versionError } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence')
        .eq('workflow_id', workflowIdNum)
        .eq('version_number', versionNumber)
        .single();

      if (versionError || !versionData) {
        return NextResponse.json(
          { success: false, error: `Version ${versionNumber} not found` },
          { status: 404 }
        );
      }

      // Prefer YAML, fallback to JSONB
      if (versionData.automation_sequence_yaml) {
        workflowData = versionData.automation_sequence_yaml;
        dataSource = 'yaml';
      } else if (versionData.automation_sequence) {
        workflowData = versionData.automation_sequence;
        dataSource = 'jsonb';
      }
    } else {
      // Get active version from database (both YAML and JSONB)
      const { data: activeVersion, error: activeError } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence, version_number')
        .eq('workflow_id', workflowIdNum)
        .eq('is_active', true)
        .single();

      if (activeError || !activeVersion) {
        return NextResponse.json(
          { success: false, error: 'No active version found' },
          { status: 404 }
        );
      }

      // Prefer YAML, fallback to JSONB
      if (activeVersion.automation_sequence_yaml) {
        workflowData = activeVersion.automation_sequence_yaml;
        dataSource = 'yaml';
      } else if (activeVersion.automation_sequence) {
        workflowData = activeVersion.automation_sequence;
        dataSource = 'jsonb';
      }
      resolvedVersion = activeVersion.version_number;
    }

    if (!workflowData) {
      return NextResponse.json(
        { success: false, error: 'Workflow data not found (no YAML or JSONB)' },
        { status: 404 }
      );
    }

    // Parse workflow data and extract step IDs
    try {
      // Parse based on data source
      let parsed: any;
      if (dataSource === 'yaml') {
        parsed = yaml.load(workflowData) as any;
        console.log(`Parsed workflow from YAML for workflow ${workflowIdNum}`);
      } else {
        // JSONB is already parsed
        parsed = workflowData;
        console.log(`Using workflow JSONB directly for workflow ${workflowIdNum}`);
      }

      if (!parsed || !parsed.steps || !Array.isArray(parsed.steps)) {
        return NextResponse.json(
          { success: false, error: `Invalid workflow ${dataSource.toUpperCase()} structure: missing steps array` },
          { status: 400 }
        );
      }

      // Extract step IDs and names
      const steps = parsed.steps.map((step: any, index: number) => ({
        id: step.id || `step_${index}`,
        name: step.name || `Step ${index + 1}`,
        tool_name: step.tool_name || 'unknown'
      }));

      console.log(`Extracted ${steps.length} steps from workflow ${workflowIdNum} (source: ${dataSource})`);

      return NextResponse.json({
        success: true,
        workflow_id: workflowIdNum,
        version: resolvedVersion,
        steps: steps,
        step_count: steps.length,
        source: dataSource
      });

    } catch (parseError) {
      console.error(`Failed to parse workflow ${dataSource}:`, parseError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to parse workflow ${dataSource}`,
          details: parseError instanceof Error ? parseError.message : String(parseError)
        },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('❌ Error extracting workflow steps:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to extract workflow steps',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
