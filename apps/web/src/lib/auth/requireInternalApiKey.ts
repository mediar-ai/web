import { NextResponse } from 'next/server';

/**
 * Guard for service-to-service internal API routes.
 *
 * Requires the caller to send `Authorization: Bearer <INTERNAL_API_KEY>`.
 * Fails closed: if INTERNAL_API_KEY is not configured, all callers are rejected.
 *
 * This mirrors the existing pattern in /api/internal/cleanup-files.
 * Returns a 401 NextResponse when the key is missing/invalid, otherwise null.
 *
 * Usage at the top of a handler:
 *   const denied = requireInternalApiKey(request);
 *   if (denied) return denied;
 */
export function requireInternalApiKey(
  request: Request
): NextResponse | null {
  const expected = process.env.INTERNAL_API_KEY;
  const authHeader = request.headers.get('authorization');
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
