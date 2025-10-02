import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Test route works!' });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ received: body, message: 'POST works!' });
}