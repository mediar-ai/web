import { NextResponse } from 'next/server';
import { getCorsHeaders } from '@/lib/cors';
import { ASK_MODE_ALLOWED_TOOLS, ASK_MODE_BLOCKED_TOOLS } from './constants';

export async function GET() {
  return NextResponse.json(
    {
      askModeAllowedTools: ASK_MODE_ALLOWED_TOOLS,
      askModeBlockedTools: ASK_MODE_BLOCKED_TOOLS,
    },
    { headers: getCorsHeaders() }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}
