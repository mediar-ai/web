import { NextResponse } from 'next/server';
import { SignJWT, importPKCS8 } from 'jose';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

export const dynamic = 'force-dynamic';

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * Generate a 1-hour Google OAuth access token for Vertex AI
 * Uses service account credentials to generate token that desktop app
 * can use to call Vertex AI directly
 */
async function generateVertexAccessToken(): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  // Try direct credentials first (Vercel production)
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  let credentials: ServiceAccountCredentials;

  if (clientEmail && privateKey) {
    credentials = {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: 'https://oauth2.googleapis.com/token',
    };
  } else {
    // Fallback to base64 credentials
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) {
      throw new Error('Missing Google credentials configuration');
    }

    credentials = JSON.parse(
      Buffer.from(credentialsBase64, 'base64').toString('utf-8')
    );
  }

  // Create JWT assertion for token exchange
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600; // 1 hour

  const jwtKey = await importPKCS8(credentials.private_key, 'RS256');

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.client_email)
    .setSubject(credentials.client_email)
    .setAudience(credentials.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(jwtKey);

  // Exchange JWT for access token
  const tokenResponse = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = await tokenResponse.json();

  return {
    accessToken: tokenData.access_token,
    expiresAt: expiresAt * 1000, // Convert to milliseconds
  };
}

/**
 * POST /api/auth/desktop-vertex-token
 *
 * Issues a 1-hour Google OAuth access token for Vertex AI
 * Desktop app can use this token to call Vertex AI directly
 *
 * Request:
 * - Header: Authorization: Bearer <desktop_session_token>
 *
 * Response:
 * - accessToken: Google OAuth access token (1hr)
 * - expiresAt: Unix timestamp (ms) when token expires
 * - project: Google Cloud project ID
 * - location: Vertex AI location
 */
export async function POST(request: Request) {
  try {
    // Extract desktop session token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      );
    }

    const desktopToken = authHeader.slice(7); // Remove 'Bearer ' prefix

    // Validate desktop session token
    const validation = await validateDesktopToken(desktopToken);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || 'Invalid desktop session' },
        { status: 401 }
      );
    }

    console.log(
      `[VertexToken] Generating token for user ${validation.userId} (${validation.email})`
    );

    // Generate 1-hour access token
    const { accessToken, expiresAt } = await generateVertexAccessToken();

    // Return token with Vertex AI configuration
    return NextResponse.json({
      accessToken,
      expiresAt,
      project: process.env.GOOGLE_CLOUD_PROJECT || 'mediar-394022',
      location: process.env.VERTEX_AI_LOCATION || 'us-central1',
      // Include user info for client-side logging
      userId: validation.userId,
      orgId: validation.orgId,
    });
  } catch (error) {
    console.error('[VertexToken] Error generating token:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Token generation failed' },
      { status: 500 }
    );
  }
}
