import { NextResponse } from 'next/server';
import { SignJWT, importPKCS8 } from 'jose';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import * as crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * Generate a stable key ID from the private key (must match JWKS endpoint)
 */
function generateKeyId(privateKey: string): string {
  return crypto
    .createHash('sha256')
    .update(privateKey)
    .digest('hex')
    .substring(0, 16);
}

/**
 * POST /api/auth/desktop-vertex-subject-token
 *
 * Issues a signed JWT (subject token) for Workload Identity Federation.
 * This token is exchanged by google-auth-library with Google STS for an access token.
 *
 * The desktop app writes an external_account ADC file that points to this endpoint.
 * When Claude Code needs a token, google-auth-library calls this endpoint automatically.
 *
 * Request:
 * - Header: Authorization: Bearer <desktop_session_token>
 *
 * Response:
 * - Plain text JWT (subject token)
 */
export async function POST(request: Request) {
  try {
    // Extract desktop session token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Missing or invalid Authorization header', {
        status: 401,
      });
    }

    const desktopToken = authHeader.slice(7); // Remove 'Bearer ' prefix

    // Validate desktop session token
    const validation = await validateDesktopToken(desktopToken);
    if (!validation.valid) {
      return new Response(validation.error || 'Invalid desktop session', {
        status: 401,
      });
    }

    console.log(
      `[VertexSubjectToken] Generating subject token for user ${validation.userId} (${validation.email})`
    );

    // Get service account credentials from base64 encoded JSON
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) {
      console.error('[VertexSubjectToken] Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');
      return new Response('Server missing Google credentials', { status: 500 });
    }

    let privateKey: string;
    try {
      const credentials = JSON.parse(
        Buffer.from(credentialsBase64, 'base64').toString('utf-8')
      );
      privateKey = credentials.private_key;
    } catch (e) {
      console.error('[VertexSubjectToken] Failed to parse credentials:', e);
      return new Response('Server credentials configuration error', { status: 500 });
    }

    // Create a signed JWT that Google STS will accept
    const now = Math.floor(Date.now() / 1000);
    const kid = generateKeyId(privateKey);

    const jwtKey = await importPKCS8(privateKey, 'RS256');

    // The JWT must have:
    // - iss: must match the issuer-uri configured in the OIDC provider
    // - aud: must match the attribute-condition in the OIDC provider
    // - sub: will be mapped to google.subject
    // - kid: must match the key ID in the JWKS
    const subjectToken = await new SignJWT({
      user_id: validation.userId,
      org_id: validation.orgId,
      email: validation.email,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
      .setIssuer('https://app.mediar.ai')
      .setSubject(validation.userId || 'anonymous')
      .setAudience('mediar-desktop-vertex')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600) // 1 hour - STS will exchange this for access token
      .sign(jwtKey);

    // Return plain text JWT - this is what credential_source expects
    return new Response(subjectToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (error) {
    console.error('[VertexSubjectToken] Error:', error);
    return new Response(
      error instanceof Error ? error.message : 'Token generation failed',
      { status: 500 }
    );
  }
}

// Also support GET for credential_source.url (google-auth-library uses GET)
export async function GET(request: Request) {
  return POST(request);
}
