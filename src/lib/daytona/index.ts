/**
 * Daytona Sandbox Management Service
 *
 * Manages per-user Daytona sandboxes for workflow editing and compilation.
 * Each user gets a persistent sandbox with their workflow .ts files.
 */

import { Daytona } from '@daytonaio/sdk';
import { createClient } from '@supabase/supabase-js';

// Types
export interface SandboxInfo {
  sandboxId: string;
  previewUrl: string;
  previewToken: string;
  state: 'running' | 'stopped' | 'archived';
  createdAt: string;
  lastAccessedAt: string;
}

export interface SandboxSession {
  userId: string;
  sandboxInfo: SandboxInfo;
}

// Initialize Daytona client
const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY!,
  target: process.env.DAYTONA_TARGET || 'us',
});

// Supabase client for storing sandbox mappings
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// In-memory cache for active sandboxes (supplement to DB)
const sandboxCache = new Map<string, SandboxInfo>();

const SERVER_SESSION_ID = 'mediar-server';

// Git repo configuration for sandbox server
const SANDBOX_REPO_URL = 'https://github.com/mediar-ai/mediar-web-app.git';
const SANDBOX_REPO_BRANCH = 'daytona'; // Will change to 'main' after PR merge
const SANDBOX_SERVER_DIR = '/home/daytona/mediar-web-app/sandbox-server';

/**
 * Start or restart the server session in a sandbox
 * Uses Daytona Sessions for proper background process management
 */
async function ensureServerRunning(sandbox: any): Promise<void> {
  console.log('[SANDBOX] Ensuring server is running...');

  // Check if server is already responding
  const healthCheck = await sandbox.process.executeCommand(
    'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000"',
    undefined,
    undefined,
    5
  );
  const httpCode = healthCheck.result?.trim();
  console.log(`[SANDBOX] Health check HTTP code: ${httpCode}`);

  if (httpCode === '200') {
    console.log('[SANDBOX] Server already running and healthy');
    return;
  }

  console.log('[SANDBOX] Server not responding, starting via session...');

  // Clean up any existing session
  try {
    await sandbox.process.deleteSession(SERVER_SESSION_ID);
    console.log('[SANDBOX] Deleted existing session');
  } catch {
    // Session doesn't exist, that's fine
  }

  // Create new session
  await sandbox.process.createSession(SERVER_SESSION_ID);
  console.log('[SANDBOX] Created server session');

  // Start server (runAsync for background)
  const startResult = await sandbox.process.executeSessionCommand(
    SERVER_SESSION_ID,
    {
      command: `cd ${SANDBOX_SERVER_DIR} && node server.js`,
      runAsync: true,
    }
  );
  console.log('[SANDBOX] Server start result:', startResult);

  // Wait for startup
  console.log('[SANDBOX] Waiting 3 seconds for server to start...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify it's running
  const verifyHealth = await sandbox.process.executeCommand(
    'curl -s -w "\\nHTTP: %{http_code}" http://localhost:3000/health 2>&1 || echo "Failed"',
    undefined,
    undefined,
    5
  );
  console.log('[SANDBOX] Server health after start:\n', verifyHealth.result);
}

/**
 * Get or create a sandbox for a user
 * No in-memory cache - Vercel serverless functions are stateless
 */
export async function getOrCreateSandbox(userId: string): Promise<SandboxInfo> {
  console.log(`[SANDBOX] getOrCreateSandbox called for user: ${userId}`);

  // Check in-memory cache first
  const cached = sandboxCache.get(userId);
  if (cached && cached.state === 'running') {
    // Update last accessed
    cached.lastAccessedAt = new Date().toISOString();
    console.log(`[SANDBOX] Found in cache: ${cached.sandboxId}`);
    return cached;
  }

  // Check database for existing sandbox
  const { data: existing, error: dbError } = await supabase
    .from('user_sandboxes')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (dbError && dbError.code !== 'PGRST116') {
    // PGRST116 = no rows returned, which is fine
    console.error('[SANDBOX] DB error:', dbError);
  }

  if (existing) {
    console.log(`[SANDBOX] Found existing sandbox in DB: ${existing.sandbox_id}, state: ${existing.state}`);

    try {
      // Try to get existing sandbox from Daytona
      const sandbox = await daytona.get(existing.sandbox_id);
      console.log(`[SANDBOX] Daytona sandbox state: ${sandbox.state}`);

      if (sandbox.state === 'started') {
        // Ensure server is running (it might have crashed)
        await ensureServerRunning(sandbox);

        const preview = await sandbox.getPreviewLink(3000);
        console.log(`[SANDBOX] Sandbox running, preview token: ${preview.token ? preview.token.substring(0, 8) + '...' : 'MISSING'}`);

        const info: SandboxInfo = {
          sandboxId: existing.sandbox_id,
          previewUrl: preview.url,
          previewToken: preview.token,
          state: 'running',
          createdAt: existing.created_at,
          lastAccessedAt: new Date().toISOString(),
        };

        // Update DB with current token (might have changed)
        const { error: updateError } = await supabase
          .from('user_sandboxes')
          .update({
            preview_url: preview.url,
            preview_token: preview.token,
            last_accessed_at: info.lastAccessedAt,
            state: 'running',
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[SANDBOX] Failed to update DB:', updateError);
        }

        sandboxCache.set(userId, info);
        return info;
      }

      // Sandbox exists but not running - start it
      console.log(`[SANDBOX] Starting stopped sandbox...`);
      await sandbox.start();
      await waitForSandboxReady(sandbox);

      // Start server session (sandbox container started but server not running)
      await ensureServerRunning(sandbox);

      const preview = await sandbox.getPreviewLink(3000);
      console.log(`[SANDBOX] Sandbox started, new token: ${preview.token ? preview.token.substring(0, 8) + '...' : 'MISSING'}`);

      const info: SandboxInfo = {
        sandboxId: existing.sandbox_id,
        previewUrl: preview.url,
        previewToken: preview.token,
        state: 'running',
        createdAt: existing.created_at,
        lastAccessedAt: new Date().toISOString(),
      };

      // Update database with new preview URL and token
      const { error: updateError } = await supabase
        .from('user_sandboxes')
        .update({
          preview_url: preview.url,
          preview_token: preview.token,
          last_accessed_at: info.lastAccessedAt,
          state: 'running',
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[SANDBOX] Failed to update DB after restart:', updateError);
      } else {
        console.log('[SANDBOX] DB updated with new token');
      }

      sandboxCache.set(userId, info);
      return info;

    } catch (error) {
      console.error('[SANDBOX] Failed to get/start existing sandbox:', error);
      console.log('[SANDBOX] Will create new sandbox...');
      // Fall through to create new sandbox
    }
  } else {
    console.log('[SANDBOX] No existing sandbox in DB, creating new one...');
  }

  // Create new sandbox
  return createNewSandbox(userId);
}

/**
 * Create a new sandbox for a user
 */
async function createNewSandbox(userId: string): Promise<SandboxInfo> {
  console.log(`Creating new sandbox for user: ${userId}`);

  const sandbox = await daytona.create({
    language: 'typescript',
    envVars: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      GOOGLE_APPLICATION_CREDENTIALS_BASE64: process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64!,
      VERTEX_AI_LOCATION: process.env.VERTEX_AI_LOCATION || 'us-central1',
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      REDIS_URL: process.env.REDIS_URL!,
      USER_ID: userId,
    },
    autoStopInterval: 60,      // Stop after 1hr inactive
    autoArchiveInterval: 120,  // Archive after 2hr stopped
  });

  console.log(`Sandbox created: ${sandbox.id}`);

  // Clone the repository with sandbox server code
  console.log('[SANDBOX] Cloning repository...');
  const githubToken = process.env.GITHUB_TOKEN;

  await sandbox.git.clone(
    SANDBOX_REPO_URL,
    '/home/daytona/mediar-web-app',
    SANDBOX_REPO_BRANCH,
    undefined, // commitId
    githubToken ? 'x-access-token' : undefined,
    githubToken || undefined
  );
  console.log('[SANDBOX] Repository cloned successfully');

  // Check files were cloned
  console.log('[SANDBOX] Checking cloned files...');
  const lsResult = await sandbox.process.executeCommand(`ls -la ${SANDBOX_SERVER_DIR}`, undefined, undefined, 10);
  console.log('[SANDBOX] Files:\n', lsResult.result);

  // Check package.json content
  const pkgResult = await sandbox.process.executeCommand(`cat ${SANDBOX_SERVER_DIR}/package.json`, undefined, undefined, 10);
  console.log('[SANDBOX] package.json:\n', pkgResult.result);

  // Install dependencies using npm (Node.js compatible)
  console.log('[SANDBOX] Installing dependencies...');
  const installResult = await sandbox.process.executeCommand(`cd ${SANDBOX_SERVER_DIR} && npm install`, undefined, undefined, 180);
  console.log('[SANDBOX] Install exit code:', installResult.exitCode);
  console.log('[SANDBOX] Install stdout:\n', installResult.result);

  // Check node_modules
  const nmResult = await sandbox.process.executeCommand(`ls ${SANDBOX_SERVER_DIR}/node_modules 2>/dev/null || echo "no node_modules"`, undefined, undefined, 10);
  console.log('[SANDBOX] node_modules:', nmResult.result);

  // Check which runtime is available
  console.log('[SANDBOX] Checking available runtimes...');
  const whichResult = await sandbox.process.executeCommand(
    'which node; node --version',
    undefined,
    undefined,
    10
  );
  console.log('[SANDBOX] Available runtimes:\n', whichResult.result);

  // Try running server directly (not in background) to see errors
  console.log('[SANDBOX] Testing server startup (5 second test)...');
  const testServerResult = await sandbox.process.executeCommand(
    `cd ${SANDBOX_SERVER_DIR} && timeout 5 node server.js 2>&1 || echo "Exit code: $?"`,
    undefined,
    undefined,
    15
  );
  console.log('[SANDBOX] Server test output:\n', testServerResult.result);
  console.log('[SANDBOX] Server test exit code:', testServerResult.exitCode);

  // Start server using Daytona Sessions
  await ensureServerRunning(sandbox);

  // Get preview URL
  const preview = await sandbox.getPreviewLink(3000);
  console.log('[SANDBOX] Preview URL:', preview);

  const info: SandboxInfo = {
    sandboxId: sandbox.id,
    previewUrl: preview.url,
    previewToken: preview.token,
    state: 'running',
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };

  // Store in database (including preview_token for Daytona proxy auth)
  console.log(`[SANDBOX] Saving to DB: sandbox_id=${sandbox.id}, token=${preview.token ? preview.token.substring(0, 8) + '...' : 'MISSING'}`);
  const { error: upsertError } = await supabase.from('user_sandboxes').upsert({
    user_id: userId,
    sandbox_id: sandbox.id,
    preview_url: preview.url,
    preview_token: preview.token,
    state: 'running',
    created_at: info.createdAt,
    last_accessed_at: info.lastAccessedAt,
  }, {
    onConflict: 'user_id',
  });

  if (upsertError) {
    console.error('[SANDBOX] Failed to save sandbox to DB:', upsertError);
  } else {
    console.log('[SANDBOX] Sandbox saved to DB successfully');
  }

  sandboxCache.set(userId, info);
  return info;
}


/**
 * Wait for sandbox to be ready
 */
async function waitForSandboxReady(sandbox: any, maxWaitMs = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const info = await sandbox.info();
      if (info.instance.state === 'started') {
        return;
      }
    } catch {
      // Ignore errors while waiting
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('Sandbox failed to start within timeout');
}

/**
 * Wait for server to be ready
 */
async function waitForServerReady(sandbox: any, maxWaitMs = 30000): Promise<void> {
  const startTime = Date.now();
  console.log('[SANDBOX] Waiting for server to be ready...');

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await sandbox.process.executeCommand(
        'curl -s http://localhost:3000/health',
        undefined,
        undefined,
        5
      );
      console.log('[SANDBOX] Health check result:', result);
      if (result.exitCode === 0 && result.result?.includes('ok')) {
        console.log('[SANDBOX] Server is ready!');
        return;
      }
    } catch (e) {
      console.log('[SANDBOX] Health check failed, retrying...', e);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('Server failed to start within timeout');
}

/**
 * Stop a user's sandbox
 */
export async function stopSandbox(userId: string): Promise<void> {
  console.log(`[SANDBOX] stopSandbox called for user: ${userId}`);

  // Get from DB
  const { data: existing } = await supabase
    .from('user_sandboxes')
    .select('sandbox_id')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    console.log('[SANDBOX] No sandbox found in DB to stop');
    return;
  }

  try {
    const sandbox = await daytona.get(existing.sandbox_id);
    await sandbox.stop();
    console.log('[SANDBOX] Sandbox stopped');

    // Update DB state
    await supabase
      .from('user_sandboxes')
      .update({ state: 'stopped' })
      .eq('user_id', userId);
  } catch (error) {
    console.error('[SANDBOX] Failed to stop sandbox:', error);
  }
}

/**
 * Delete a user's sandbox
 */
export async function deleteSandbox(userId: string): Promise<void> {
  console.log(`[SANDBOX] deleteSandbox called for user: ${userId}`);

  // Get from DB
  const { data: existing } = await supabase
    .from('user_sandboxes')
    .select('sandbox_id')
    .eq('user_id', userId)
    .single();

  if (existing) {
    try {
      const sandbox = await daytona.get(existing.sandbox_id);
      await sandbox.delete();
      console.log('[SANDBOX] Sandbox deleted from Daytona');
    } catch (error) {
      console.error('[SANDBOX] Failed to delete sandbox from Daytona:', error);
    }
  }

  // Remove from database
  const { error } = await supabase
    .from('user_sandboxes')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('[SANDBOX] Failed to delete sandbox from DB:', error);
  } else {
    console.log('[SANDBOX] Sandbox deleted from DB');
  }
}
