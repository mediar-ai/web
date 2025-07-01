import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  // Redirect to unified endpoint
  const { executionId } = await params;
  return NextResponse.redirect(new URL(`/api/remote-workflows/executions/${executionId}`, request.url));
}
