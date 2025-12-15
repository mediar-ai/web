import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/openid-configuration
 *
 * OIDC Discovery endpoint for Workload Identity Federation.
 * Google STS uses this to find the JWKS URL for verifying our JWTs.
 */
export async function GET() {
  const issuer = 'https://app.mediar.ai';

  const config = {
    issuer,
    jwks_uri: `${issuer}/api/auth/jwks`,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    response_types_supported: ['id_token'],
    claims_supported: ['sub', 'aud', 'iss', 'iat', 'exp', 'user_id', 'org_id', 'email'],
  };

  return NextResponse.json(config, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
