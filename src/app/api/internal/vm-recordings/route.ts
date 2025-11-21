import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import { isMediarAdmin } from '@/lib/mediarAuth';

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

    // Define potential paths to check
    const pathsToCheck = [
      `${date}/${machineName}`,
      `recordings/${machineName}/${date}`,
      `recordings/${date}/${machineName}`,
    ];

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

    if (!files || files.length === 0) {
      return NextResponse.json(
        {
          message: 'No recordings found for this machine and date',
          machine: machineName,
          date,
          paths_checked: pathsToCheck,
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

    return NextResponse.json({
      success: true,
      machine: machineName,
      date,
      recordings,
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
