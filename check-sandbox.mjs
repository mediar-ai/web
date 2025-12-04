// Debug script to check inside the sandbox
import { Daytona } from '@daytonaio/sdk';

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  target: 'us',
});

async function main() {
  const sandboxId = process.argv[2];
  if (!sandboxId) {
    console.log('Usage: node check-sandbox.mjs <sandbox-id>');
    process.exit(1);
  }

  console.log(`Checking sandbox: ${sandboxId}`);

  try {
    const sandbox = await daytona.get(sandboxId);
    console.log('Sandbox state:', sandbox.instance?.state);

    // List files
    console.log('\n=== Files in /home/daytona ===');
    const lsResult = await sandbox.process.executeCommand('ls -la /home/daytona', undefined, undefined, 10);
    console.log(lsResult.result);

    // Check server.js
    console.log('\n=== server.js content ===');
    const catResult = await sandbox.process.executeCommand('cat /home/daytona/server.js 2>/dev/null || echo "File not found"', undefined, undefined, 10);
    console.log(catResult.result);

    // Check for running processes
    console.log('\n=== Running processes ===');
    const psResult = await sandbox.process.executeCommand('ps aux', undefined, undefined, 10);
    console.log(psResult.result);

    // Check Node.js version
    console.log('\n=== Node.js version ===');
    const nodeResult = await sandbox.process.executeCommand('node --version', undefined, undefined, 10);
    console.log(nodeResult.result);

    // Check server logs
    console.log('\n=== Server logs ===');
    const logResult = await sandbox.process.executeCommand('cat /tmp/server.log 2>/dev/null || echo "No log file"', undefined, undefined, 10);
    console.log(logResult.result);

    // Try to start server manually
    console.log('\n=== Attempting to start server manually ===');
    const startResult = await sandbox.process.executeCommand('cd /home/daytona && node server.js &', undefined, undefined, 10);
    console.log('Start result:', startResult);

    // Wait and check
    await new Promise(r => setTimeout(r, 2000));

    console.log('\n=== Health check after manual start ===');
    const healthResult = await sandbox.process.executeCommand('curl -s http://localhost:3000/health || echo "Failed"', undefined, undefined, 10);
    console.log(healthResult.result);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
