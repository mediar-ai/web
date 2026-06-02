import { NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';

/**
 * Guard for Mediar-internal admin API routes.
 *
 * Accepts either:
 *  - a Clerk session whose user has an @mediar.ai email (the admin dashboard), or
 *  - a desktop Bearer token whose user has an @mediar.ai email (the desktop app).
 *
 * Returns a 403 NextResponse when the caller is not a Mediar admin, otherwise null.
 * Usage at the top of a handler:
 *   const denied = await requireMediarAdmin();
 *   if (denied) return denied;
 */
export async function requireMediarAdmin(): Promise<NextResponse | null> {
  if (await isMediarAdmin()) return null;
  return NextResponse.json(
    { error: 'Access denied. Mediar admin only.' },
    { status: 403 }
  );
}
