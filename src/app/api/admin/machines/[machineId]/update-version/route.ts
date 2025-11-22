import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase environment variables are not set');
}

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function POST(
  request: Request,
  { params }: { params: { machineId: string } }
) {
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    const machineId = parseInt(params.machineId);
    const { version = 'latest' } = await request.json();

    // Fetch machine details
    const { data: machine, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
    }

    // Ensure machine has Azure Resource ID
    if (!machine.azure_resource_id) {
      return NextResponse.json(
        { error: 'Machine does not have Azure Resource ID configured' },
        { status: 400 }
      );
    }

    // Parse Azure Resource ID to get resource group and VM name
    // Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{name}
    const parts = machine.azure_resource_id.split('/');
    const rgIndex = parts.indexOf('resourceGroups');
    const vmIndex = parts.indexOf('virtualMachines');

    if (rgIndex === -1 || vmIndex === -1) {
      return NextResponse.json(
        { error: 'Invalid Azure Resource ID format' },
        { status: 400 }
      );
    }

    const resourceGroup = parts[rgIndex + 1];
    const vmName = parts[vmIndex + 1];

    console.log(
      `[Update MCP] Triggering update for ${vmName} in ${resourceGroup} to version ${version}`
    );

    // Read the update script
    const scriptPath = join(
      process.cwd(),
      '..',
      'agents',
      'packer-terraform',
      'scripts',
      'update-mcp-agent.ps1'
    );
    let scriptContent: string;
    try {
      scriptContent = readFileSync(scriptPath, 'utf-8');
    } catch (err) {
      console.error('Failed to read update script:', err);
      return NextResponse.json(
        { error: 'Update script not found' },
        { status: 500 }
      );
    }

    // Execute Azure Run Command to update the VM
    const azCommand = `az vm run-command invoke \\
      --resource-group "${resourceGroup}" \\
      --name "${vmName}" \\
      --command-id RunPowerShellScript \\
      --scripts @- << 'SCRIPT_EOF'
${scriptContent}
SCRIPT_EOF`;

    console.log(`[Update MCP] Executing Azure Run Command...`);

    try {
      const { stdout, stderr } = await execAsync(azCommand, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      console.log(`[Update MCP] Command output:`, stdout);
      if (stderr) {
        console.warn(`[Update MCP] Command stderr:`, stderr);
      }

      // Parse the run command output
      let runCommandResult: any = {};
      try {
        runCommandResult = JSON.parse(stdout);
      } catch {
        console.warn('[Update MCP] Could not parse run command output');
      }

      // Check if update was successful
      const success =
        runCommandResult.value &&
        runCommandResult.value.some((v: any) => v.code === 'ComponentStatus/StdOut/succeeded');

      if (!success) {
        return NextResponse.json(
          {
            error: 'Update command executed but may have failed',
            details: runCommandResult,
          },
          { status: 500 }
        );
      }

      // Update machine status to trigger health check
      await supabase
        .from('remote_machines')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', machineId);

      return NextResponse.json({
        success: true,
        message: `Update triggered for ${machine.name}`,
        version,
        vmName,
        resourceGroup,
        details: runCommandResult,
      });
    } catch (execError: any) {
      console.error('[Update MCP] Execution error:', execError);
      return NextResponse.json(
        {
          error: 'Failed to execute update command',
          details: execError.message,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[Update MCP] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Update failed' },
      { status: 500 }
    );
  }
}
