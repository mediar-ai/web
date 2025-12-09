import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { filePath, action = 'select' } = await request.json();

    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json(
        { error: 'File path is required' },
        { status: 400 }
      );
    }

    // Validate that it's a Windows path
    if (!filePath.match(/^[A-Z]:\\/i)) {
      return NextResponse.json(
        { error: 'Invalid Windows file path' },
        { status: 400 }
      );
    }

    // Replace the username in the path with the current user's username
    // This handles VM vs local machine username differences
    const currentUsername = process.env.USERNAME || process.env.USER || 'screenpipe-windows';
    const localFilePath = filePath.replace(/C:\\Users\\[^\\]+\\/, `C:\\Users\\${currentUsername}\\`);

    console.log(`Received path: ${filePath}`);
    console.log(`Current username: ${currentUsername}`);
    console.log(`Adjusted path: ${localFilePath}`);
    console.log(`Action: ${action}`);

    // Choose command based on action
    let command;
    if (action === 'open') {
      // Open file with default application
      command = `start "" "${localFilePath}"`;
    } else {
      // Default: Open Explorer and highlight the file
      command = `explorer.exe /select,"${localFilePath}"`;
    }

    try {
      // First check if file exists
      if (!existsSync(localFilePath)) {
        console.error(`File not found: ${localFilePath}`);
        return NextResponse.json(
          {
            error: 'File not found on your local machine',
            details: `The file "${localFilePath.split('\\').pop()}" doesn't exist at the expected location. It may not have synced from OneDrive yet, or you might need to sync the folder.`,
            path: localFilePath,
            suggestions: [
              'Check if OneDrive is running and syncing',
              'Verify the file exists in OneDrive web interface',
              'Wait a few moments for OneDrive to sync the file'
            ]
          },
          { status: 404 }
        );
      }

      await execAsync(command);
      const actionMessage = action === 'open' ? 'File opened' : 'Opened in Explorer';
      return NextResponse.json({
        success: true,
        message: actionMessage,
        path: localFilePath,
      });
    } catch (error) {
      console.error('Error opening file:', error);
      return NextResponse.json(
        {
          error: 'Failed to open file',
          details: error instanceof Error ? error.message : 'Unknown error',
          path: localFilePath,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      {
        error: 'Invalid request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 400 }
    );
  }
}
