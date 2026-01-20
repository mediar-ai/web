import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { promises as dns } from 'dns';
import { DefaultAzureCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    const { executionId } = await params;

    // 1. Authentication check
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch execution details to get machine and timestamps
    // Using the workflow_executions table which links to remote_machines
    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .select(
        `
        *,
        remote_machines (
          name,
          mcp_endpoint,
          azure_resource_id,
          computer_name
        )
      `
      )
      .eq('id', executionId)
      .single();

    if (executionError || !execution) {
      console.error('Error fetching execution:', executionError);
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Optional: Check organization access
    // if (execution.workflows?.organization_id && execution.workflows.organization_id !== orgId) {
    //   return NextResponse.json({ error: 'Unauthorized access to execution' }, { status: 403 });
    // }

    // 3. Determine recording path parameters
    // We need the assigned machine name and the start/end times
    const assignedMachineName = execution.remote_machines?.name;
    const mcpEndpoint = execution.remote_machines?.mcp_endpoint;
    const azureResourceId = execution.remote_machines?.azure_resource_id;
    // computer_name is the Windows COMPUTERNAME used for recording folders
    const computerName = execution.remote_machines?.computer_name;

    console.log('[Recording API] Execution details:', {
      id: executionId,
      machine: assignedMachineName,
      computerName,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
    });

    if (!assignedMachineName || !execution.started_at) {
      console.log('[Recording API] Missing machine or start time');
      return NextResponse.json(
        {
          message: 'No machine assignment or start time for this execution',
        },
        { status: 404 }
      );
    }

    const startDate = new Date(execution.started_at);
    // Default to now if not completed (running execution) or 1 hour max if undefined
    const endDate = execution.completed_at
      ? new Date(execution.completed_at)
      : new Date(startDate.getTime() + 60 * 60 * 1000);

    // Format date for folder structure: YYYY-MM-DD
    // Note: This assumes the recording folder uses the same date as the execution start time
    // This might need adjustment if an execution spans across days (UTC vs Local)
    const dateFolder = startDate.toISOString().split('T')[0];
    const machineName = assignedMachineName;

    // Determine potential paths to check
    const pathsToCheck: string[] = [];

    // Priority 1: Use computer_name if available (most reliable for recordings)
    if (computerName) {
      pathsToCheck.push(`recordings/${computerName}/${dateFolder}`);
      pathsToCheck.push(`recordings/${dateFolder}/${computerName}`);
      pathsToCheck.push(`${dateFolder}/${computerName}`);
    }

    // 1. Current structure: {date}/{machine_name}
    pathsToCheck.push(`${dateFolder}/${machineName}`);

    // 2. New structure from script: recordings/{machine_name}/{date}
    pathsToCheck.push(`recordings/${machineName}/${dateFolder}`);

    // 3. Another variation: recordings/{date}/{machine_name}
    pathsToCheck.push(`recordings/${dateFolder}/${machineName}`);

    // 3. Check MCP endpoint hostname variants
    if (mcpEndpoint) {
      try {
        const urlStr = mcpEndpoint.startsWith('http')
          ? mcpEndpoint
          : `http://${mcpEndpoint}`;
        const url = new URL(urlStr);
        const hostname = url.hostname;

        // Check if hostname is an IP address
        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);

        let mcpName = '';

        if (isIp) {
          // If IP, try reverse DNS lookup to get hostname
          try {
            console.log(`[Recording API] Doing reverse DNS for ${hostname}`);
            const hostnames = await dns.reverse(hostname);
            if (hostnames && hostnames.length > 0) {
              // e.g. mcp-imperial-1.internal -> mcp-imperial-1
              mcpName = hostnames[0].split('.')[0];
              console.log(`[Recording API] Resolved ${hostname} to ${mcpName}`);
            }
          } catch (dnsError) {
            console.warn(
              `[Recording API] Reverse DNS lookup failed for ${hostname}:`,
              dnsError
            );
          }
        } else {
          // Use hostname first part
          mcpName = hostname.split('.')[0];
        }

        if (mcpName && mcpName !== machineName) {
          pathsToCheck.push(`${dateFolder}/${mcpName}`);
          pathsToCheck.push(`recordings/${mcpName}/${dateFolder}`);
          pathsToCheck.push(`recordings/${dateFolder}/${mcpName}`);
        }
      } catch (e) {
        console.warn('[Recording API] Error parsing MCP endpoint:', e);
      }
    }

    // 4. Azure Resource ID Lookup (most reliable for VMs)
    if (azureResourceId) {
      try {
        console.log(
          `[Recording API] Doing Azure lookup for ${azureResourceId}`
        );
        // resourceId format: /subscriptions/{subId}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vmName}
        const parts = azureResourceId.split('/');
        const subscriptionId = parts[2];
        const resourceGroupName = parts[4];
        const vmName = parts[8];

        if (subscriptionId && resourceGroupName && vmName) {
          const credential = new DefaultAzureCredential();
          const client = new ComputeManagementClient(
            credential,
            subscriptionId
          );
          const vm = await client.virtualMachines.get(
            resourceGroupName,
            vmName
          );
          const computerName = vm.osProfile?.computerName;

          if (computerName) {
            console.log(
              `[Recording API] Azure resolved computer name: ${computerName}`
            );
            const variants = [
              `${dateFolder}/${computerName}`,
              `recordings/${computerName}/${dateFolder}`,
              `recordings/${dateFolder}/${computerName}`,
            ];
            for (const variant of variants) {
              if (!pathsToCheck.includes(variant)) {
                pathsToCheck.push(variant);
              }
            }
          }
        }
      } catch (azureError) {
        console.warn('[Recording API] Azure lookup failed:', azureError);
      }
    }

    console.log('[Recording API] Paths to check:', pathsToCheck);

    // 4. Search for files in potential paths
    let files = null;
    let storageError = null;
    let storagePath = '';

    for (const path of pathsToCheck) {
      console.log(`[Recording API] Checking path: ${path}`);
      const { data, error } = await supabase.storage
        .from('workflow-files')
        .list(path, {
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        });

      if (!error && data && data.length > 0) {
        console.log(`[Recording API] Found recordings in: ${path}`);
        files = data;
        storagePath = path;
        storageError = null;
        break;
      }

      if (error) {
        console.warn(`[Recording API] Error checking path ${path}:`, error);
        storageError = error;
      }
    }

    // If no files found in specific paths, try discovery in the date folder
    let availableFolders: string[] = [];

    if (!files || files.length === 0) {
      console.log(
        '[Recording API] No files found in specific paths. Trying discovery mode.'
      );

      // Debug: List root to ensure we are looking at correct bucket structure
      const { data: rootContents } = await supabase.storage
        .from('workflow-files')
        .list('');
      console.log(
        '[Recording API] Bucket root contents:',
        rootContents?.map(f => f.name)
      );

      // List the date folder
      const { data: dateContents } = await supabase.storage
        .from('workflow-files')
        .list(dateFolder);

      // Also check inside recordings/{date}
      const { data: recordingsDateContents } = await supabase.storage
        .from('workflow-files')
        .list(`recordings/${dateFolder}`);

      const discoveredPaths = [
        ...(dateContents?.map(f => `${dateFolder}/${f.name}`) || []),
        ...(recordingsDateContents?.map(
          f => `recordings/${dateFolder}/${f.name}`
        ) || []),
      ];

      availableFolders = discoveredPaths;
      console.log(
        '[Recording API] Available folders in discovery directories:',
        availableFolders
      );

      // Try each discovered path
      for (const fuzzyPath of availableFolders) {
        // Skip if we already checked this path exactly
        if (pathsToCheck.includes(fuzzyPath)) continue;

        console.log(`[Recording API] Checking discovered path: ${fuzzyPath}`);
        const { data: fuzzyFiles, error: fuzzyError } = await supabase.storage
          .from('workflow-files')
          .list(fuzzyPath, {
            limit: 100,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (!fuzzyError && fuzzyFiles && fuzzyFiles.length > 0) {
          // Check if it contains mp4 files
          if (fuzzyFiles.some(f => f.name.endsWith('.mp4'))) {
            console.log(
              `[Recording API] Found recordings in fuzzy path: ${fuzzyPath}`
            );
            files = fuzzyFiles;
            storagePath = fuzzyPath;
            storageError = null;
            break;
          }
        }
      }
    }

    if (!files || files.length === 0) {
      storagePath = storagePath || pathsToCheck.join(' OR ');

      return NextResponse.json(
        {
          message: 'No recordings found for this date and machine',
          path: storagePath,
          available_folders: availableFolders,
          error: storageError?.message,
        },
        { status: 404 }
      );
    }

    // 5. Filter files that overlap with the execution time window
    // Expected file format: "HH-mm-ss.mp4" (e.g., "16-12-45.mp4")
    const executionStartTimeMs = startDate.getTime();
    const executionEndTimeMs = endDate.getTime();

    // Assume a default chunk duration if unknown (e.g., 10 minutes)
    const ASSUMED_CHUNK_DURATION_MS = 10 * 60 * 1000;

    const relevantFiles = files.filter(file => {
      if (!file.name.endsWith('.mp4')) return false;

      // Parse filename time
      const timeParts = file.name.replace('.mp4', '').split('-');
      if (timeParts.length < 3) return false;

      const [hours, minutes, seconds] = timeParts.map(Number);

      // Construct file date object (using the date folder's date)
      // Note: We construct this in UTC to match ISO string parsing behavior if needed,
      // or keep consistent with how the folder date was derived.
      // Assuming filename time is matching the execution timezone logic.
      const fileDate = new Date(startDate);
      fileDate.setUTCHours(hours, minutes, seconds, 0);

      // Handle edge case where file time might look like it's 'before' if execution date boundaries are tricky
      // For now, simple comparison:
      const fileStartTimeMs = fileDate.getTime();
      const fileEndTimeMs = fileStartTimeMs + ASSUMED_CHUNK_DURATION_MS;

      // Check for overlap:
      // (File Start < Execution End) AND (File End > Execution Start)
      return (
        fileStartTimeMs < executionEndTimeMs &&
        fileEndTimeMs > executionStartTimeMs
      );
    });

    if (relevantFiles.length === 0) {
      console.log(
        '[Recording API] No relevant files found matching time window'
      );
      return NextResponse.json(
        {
          message: 'No relevant recording segments found in time window',
          files_found_in_folder: files.length,
          time_window: { start: startDate, end: endDate },
        },
        { status: 404 }
      );
    }

    // 6. Generate signed URLs for the relevant segments
    const signedUrls = await Promise.all(
      relevantFiles.map(async file => {
        const filePath = `${storagePath}/${file.name}`;
        console.log(
          `[Recording API] Generating signed URL for: ${filePath}, size: ${file.metadata?.size}`
        );

        const { data, error } = await supabase.storage
          .from('workflow-files')
          .createSignedUrl(filePath, 3600); // 1 hour expiry

        if (error) {
          console.error(
            `[Recording API] Error generating signed URL for ${filePath}:`,
            error
          );
        } else {
          console.log(
            `[Recording API] Generated signed URL for ${filePath}: ${data?.signedUrl?.substring(
              0,
              50
            )}...`
          );
        }

        return {
          filename: file.name,
          path: filePath,
          url: data?.signedUrl,
          size: file.metadata?.size,
          lastModified: file.updated_at,
        };
      })
    );

    return NextResponse.json({
      execution_id: executionId,
      machine: machineName,
      time_window: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      recordings: signedUrls,
    });
  } catch (error) {
    console.error('Error processing recording request:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
