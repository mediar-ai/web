/**
 * GitHub App Authentication Helper
 *
 * Uses GitHub App credentials (App ID, Private Key, Installation ID) to create
 * authenticated Octokit instances. Commits will appear as "mediar-workflowmt[bot]"
 * instead of a personal account.
 *
 * Required environment variables:
 * - GITHUB_APP_ID: The App ID (e.g., "2442787")
 * - GITHUB_APP_PRIVATE_KEY: The private key in PEM format
 * - GITHUB_APP_INSTALLATION_ID: The installation ID (e.g., "98821818")
 *
 * Falls back to GITHUB_WORKFLOW_TOKEN or GITHUB_TOKEN if App credentials not configured.
 */

import { Octokit } from '@octokit/rest';

// Cache for the installation token (valid for 1 hour)
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Create a JWT for GitHub App authentication
 */
function createAppJWT(appId: string, privateKey: string): string {
  // JWT implementation using Node.js crypto
  const crypto = require('crypto');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60 seconds ago (clock drift)
    exp: now + (10 * 60), // Expires in 10 minutes
    iss: appId,
  };

  const header = { alg: 'RS256', typ: 'JWT' };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signatureInput = `${base64Header}.${base64Payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, 'base64url');

  return `${signatureInput}.${signature}`;
}

/**
 * Get an installation access token for the GitHub App
 */
async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string
): Promise<string> {
  // Check cache first
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const jwt = createAppJWT(appId, privateKey);

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'mediar-workflow-bot',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get installation token: ${response.status} ${error}`);
  }

  const data = await response.json();

  // Cache the token (expires in ~1 hour, we cache for 50 mins)
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + (50 * 60 * 1000);

  return data.token;
}

/**
 * Check if GitHub App authentication is configured
 */
export function isGitHubAppConfigured(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_INSTALLATION_ID
  );
}

/**
 * Get an authenticated Octokit instance
 *
 * Prioritizes GitHub App authentication if configured,
 * falls back to personal access token.
 */
export async function getAuthenticatedOctokit(): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  // If GitHub App is configured, use it
  if (appId && privateKey && installationId) {
    try {
      // Handle private key format (may have escaped newlines)
      const formattedKey = privateKey.replace(/\\n/g, '\n');

      const token = await getInstallationToken(appId, formattedKey, installationId);

      console.log('[GitHub] Using App authentication (mediar-workflowmt[bot])');

      return new Octokit({
        auth: token,
        userAgent: 'mediar-workflow-bot',
      });
    } catch (error) {
      console.error('[GitHub] App authentication failed, falling back to PAT:', error);
    }
  }

  // Fall back to personal access token
  const pat = process.env.GITHUB_WORKFLOW_TOKEN || process.env.GITHUB_TOKEN;

  if (!pat) {
    throw new Error('No GitHub authentication configured. Set either GITHUB_APP_* or GITHUB_TOKEN.');
  }

  console.log('[GitHub] Using personal access token authentication');

  return new Octokit({
    auth: pat,
    userAgent: 'mediar-workflow-manager',
  });
}

/**
 * Get GitHub token for simple fetch operations
 * Returns installation token if App is configured, otherwise PAT
 */
export async function getGitHubToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    try {
      const formattedKey = privateKey.replace(/\\n/g, '\n');
      return await getInstallationToken(appId, formattedKey, installationId);
    } catch (error) {
      console.error('[GitHub] Failed to get App token:', error);
    }
  }

  const pat = process.env.GITHUB_WORKFLOW_TOKEN || process.env.GITHUB_TOKEN;
  if (!pat) {
    throw new Error('No GitHub token configured');
  }

  return pat;
}
