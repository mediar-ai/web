import { NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/desktop-anthropic-key
 *
 * Returns the Anthropic API key for authenticated desktop clients.
 * The desktop app uses this to spawn claude-code-acp with direct API access.
 *
 * Request:
 * - Header: Authorization: Bearer <desktop_session_token>
 *
 * Response:
 * - JSON: { apiKey: string }
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Missing or invalid Authorization header', {
        status: 401,
      });
    }

    const desktopToken = authHeader.slice(7);

    const validation = await validateDesktopToken(desktopToken);
    if (!validation.valid) {
      return new Response(validation.error || 'Invalid desktop session', {
        status: 401,
      });
    }

    console.log(
      `[desktop-anthropic-key] Providing API key for user ${validation.userId} (${validation.email})`
    );

    const apiKey = process.env.ANTHROPIC_DESKTOP_API_KEY;
    if (!apiKey) {
      console.error('[desktop-anthropic-key] Missing ANTHROPIC_DESKTOP_API_KEY env var');
      return new Response('Server missing Anthropic API key configuration', { status: 500 });
    }

    return NextResponse.json({ apiKey });
  } catch (error) {
    console.error('[desktop-anthropic-key] Error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
