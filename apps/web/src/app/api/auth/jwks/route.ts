import { NextResponse } from 'next/server';
import { importPKCS8, exportJWK } from 'jose';
import * as crypto from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/jwks
 *
 * JSON Web Key Set endpoint for Workload Identity Federation.
 * Returns the public key used to verify subject tokens.
 * Google STS calls this to get our public key for JWT verification.
 */
export async function GET() {
  try {
    // Get service account credentials from base64 encoded JSON
    const credentialsBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
    if (!credentialsBase64) {
      console.error('[JWKS] Missing GOOGLE_APPLICATION_CREDENTIALS_BASE64');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    let privateKey: string;
    try {
      const credentials = JSON.parse(
        Buffer.from(credentialsBase64, 'base64').toString('utf-8')
      );
      privateKey = credentials.private_key;
    } catch (e) {
      console.error('[JWKS] Failed to parse credentials:', e);
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Import the private key
    const key = await importPKCS8(privateKey, 'RS256');

    // Export as JWK (this gives us the public components)
    const jwk = await exportJWK(key);

    // Remove private key components, keep only public
    const publicJwk = {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      use: 'sig',
      kid: generateKeyId(privateKey),
    };

    const jwks = {
      keys: [publicJwk],
    };

    return NextResponse.json(jwks, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('[JWKS] Error generating JWKS:', error);
    return NextResponse.json(
      { error: 'Failed to generate JWKS' },
      { status: 500 }
    );
  }
}

/**
 * Generate a stable key ID from the private key
 */
function generateKeyId(privateKey: string): string {
  return crypto
    .createHash('sha256')
    .update(privateKey)
    .digest('hex')
    .substring(0, 16);
}
