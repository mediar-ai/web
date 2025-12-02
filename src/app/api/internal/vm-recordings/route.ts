import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import { isMediarAdmin } from '@/lib/mediarAuth';
import { promises as dns } from 'dns';
import { DefaultAzureCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is Mediar admin (internal tool)
    const isAdmin = await isMediarAdmin();
    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Access denied - Mediar admin only' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const machineName = searchParams.get('machine');
    const date = searchParams.get('date'); // Format: YYYY-MM-DD

    if (!machineName || !date) {
      return NextResponse.json(
        { error: 'Missing required parameters: machine and date' },
        { status: 400 }
      );
    }

    console.log('[VM Recordings API] Fetching recordings for:', {
      machine: machineName,
      date,
    });

    // Fetch machine details from database to get Azure resource ID and MCP endpoint
    const { data: machineData, error: machineError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('name', machineName)
      .single();

    if (machineError || !machineData) {
      console.error('[VM Recordings API] Machine not found:', machineError);
      return NextResponse.json(
        { error: 'Machine not found in database' },
        { status: 404 }
      );
    }

    const mcpEndpoint = machineData.mcp_endpoint;
    const azureResourceId = machineData.azure_resource_id;
    const dbComputerName = machineData.computer_name;

    console.log('[VM Recordings API] Machine details:', {
      name: machineName,
      mcpEndpoint,
      azureResourceId,
      dbComputerName,
    });

    // Define potential paths to check
    const pathsToCheck: string[] = [];

    // Priority 1: Use computer_name from database if available (most reliable)
    if (dbComputerName) {
      pathsToCheck.push(`recordings/${dbComputerName}/${date}`);
      pathsToCheck.push(`recordings/${date}/${dbComputerName}`);
      pathsToCheck.push(`${date}/${dbComputerName}`);
    }

    // Fallback: Use machine name from database
    pathsToCheck.push(`${date}/${machineName}`);
    pathsToCheck.push(`recordings/${machineName}/${date}`);
    pathsToCheck.push(`recordings/${date}/${machineName}`);

    // Try to resolve actual computer name from MCP endpoint (reverse DNS)
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
            console.log(`[VM Recordings API] Doing reverse DNS for ${hostname}`);
            const hostnames = await dns.reverse(hostname);
            if (hostnames && hostnames.length > 0) {
              // e.g. mcp-imperial-1.internal -> mcp-imperial-1
              mcpName = hostnames[0].split('.')[0];
              console.log(`[VM Recordings API] Resolved ${hostname} to ${mcpName}`);
            }
          } catch (dnsError) {
            console.warn(
              `[VM Recordings API] Reverse DNS lookup failed for ${hostname}:`,
              dnsError
            );
          }
        } else {
          // Use hostname first part
          mcpName = hostname.split('.')[0];
        }

        if (mcpName && mcpName !== machineName) {
          pathsToCheck.push(`${date}/${mcpName}`);
          pathsToCheck.push(`recordings/${mcpName}/${date}`);
          pathsToCheck.push(`recordings/${date}/${mcpName}`);
        }
      } catch (e) {
        console.warn('[VM Recordings API] Error parsing MCP endpoint:', e);
      }
    }

    // Try Azure Resource ID Lookup (most reliable for VMs)
    if (azureResourceId) {
      try {
        console.log(
          `[VM Recordings API] Doing Azure lookup for ${azureResourceId}`
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
              `[VM Recordings API] Azure resolved computer name: ${computerName}`
            );
            const variants = [
              `${date}/${computerName}`,
              `recordings/${computerName}/${date}`,
              `recordings/${date}/${computerName}`,
            ];
            for (const variant of variants) {
              if (!pathsToCheck.includes(variant)) {
                pathsToCheck.push(variant);
              }
            }
          }
        }
      } catch (azureError) {
        console.warn('[VM Recordings API] Azure lookup failed:', azureError);
      }
    }

    console.log('[VM Recordings API] Paths to check:', pathsToCheck);

    let files = null;
    let storagePath = '';

    // Check each path for recordings
    for (const path of pathsToCheck) {
      console.log(`[VM Recordings API] Checking path: ${path}`);
      const { data, error } = await supabase.storage
        .from('workflow-files')
        .list(path, {
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        });

      if (!error && data && data.length > 0) {
        const mp4Files = data.filter(f => f.name.endsWith('.mp4'));
        if (mp4Files.length > 0) {
          console.log(`[VM Recordings API] Found recordings in: ${path}`);
          files = mp4Files;
          storagePath = path;
          break;
        }
      }
    }

    // If no files found in specific paths, try discovery mode
    let availableFolders: string[] = [];

    if (!files || files.length === 0) {
      console.log(
        '[VM Recordings API] No files found in specific paths. Trying discovery mode.'
      );

      // List the date folder and recordings/{date} to find all available machine folders
      const { data: dateContents } = await supabase.storage
        .from('workflow-files')
        .list(date);

      const { data: recordingsDateContents } = await supabase.storage
        .from('workflow-files')
        .list(`recordings/${date}`);

      const discoveredPaths = [
        ...(dateContents?.map(f => `${date}/${f.name}`) || []),
        ...(recordingsDateContents?.map(
          f => `recordings/${date}/${f.name}`
        ) || []),
      ];

      availableFolders = discoveredPaths;
      console.log(
        '[VM Recordings API] Available folders in discovery directories:',
        availableFolders
      );

      // Try each discovered path
      for (const fuzzyPath of availableFolders) {
        // Skip if we already checked this path exactly
        if (pathsToCheck.includes(fuzzyPath)) continue;

        console.log(`[VM Recordings API] Checking discovered path: ${fuzzyPath}`);
        const { data: fuzzyFiles, error: fuzzyError } = await supabase.storage
          .from('workflow-files')
          .list(fuzzyPath, {
            limit: 1000,
            offset: 0,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (!fuzzyError && fuzzyFiles && fuzzyFiles.length > 0) {
          // Check if it contains mp4 files
          const mp4Files = fuzzyFiles.filter(f => f.name.endsWith('.mp4'));
          if (mp4Files.length > 0) {
            console.log(
              `[VM Recordings API] Found recordings in fuzzy path: ${fuzzyPath}`
            );
            files = mp4Files;
            storagePath = fuzzyPath;
            break;
          }
        }
      }
    }

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          message: 'No recordings found for this machine and date',
          machine: machineName,
          date,
          paths_checked: pathsToCheck,
          available_folders: availableFolders,
        },
        { status: 404 }
      );
    }

    // Generate signed URLs for the recordings
    const recordings = await Promise.all(
      files.map(async file => {
        const filePath = `${storagePath}/${file.name}`;
        const { data } = await supabase.storage
          .from('workflow-files')
          .createSignedUrl(filePath, 3600); // 1 hour expiry

        return {
          filename: file.name,
          path: filePath,
          url: data?.signedUrl || '',
          size: file.metadata?.size || 0,
          lastModified: file.updated_at || file.created_at || '',
        };
      })
    );

    // Extract computer name from storage path for logs query
    // Path format: recordings/{computerName}/{date} or {date}/{computerName}
    const pathParts = storagePath.split('/');
    let computerName = machineName;

    if (pathParts.length >= 2) {
      // Try to extract computer name from path
      const lastPart = pathParts[pathParts.length - 1];
      const secondLastPart = pathParts[pathParts.length - 2];

      // If last part is a date, computer name is second-to-last
      if (/^\d{4}-\d{2}-\d{2}$/.test(lastPart)) {
        computerName = secondLastPart;
      } else {
        computerName = lastPart;
      }
    }

    console.log('[VM Recordings API] Extracted computer name:', computerName, 'from path:', storagePath);

    return NextResponse.json({
      success: true,
      machine: machineName,
      computer_name: computerName,
      date,
      recordings,
      storage_path: storagePath,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[VM Recordings API] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch VM recordings',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
