import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { userId, getToken } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get a Supabase-compatible JWT token from Clerk
    const token = await getToken({ template: 'supabase' });
    
    if (!token) {
      return NextResponse.json({ error: 'Failed to get auth token' }, { status: 500 });
    }

    return NextResponse.json({ token });
  } catch (error) {
    console.error('Error getting Clerk-Supabase token:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 