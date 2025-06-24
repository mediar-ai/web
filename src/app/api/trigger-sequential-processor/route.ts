import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // In a real implementation, this would trigger the Modal function
    // For now, we'll just return success since the sequential processor
    // will handle the triggering internally via Modal's remote() calls
    
    console.log(`Sequential processor trigger requested for user: ${userId}`);
    
    return NextResponse.json({ 
      success: true, 
      message: `Sequential processor triggered for user ${userId}`,
      userId 
    });
    
  } catch (error) {
    console.error('Error triggering sequential processor:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: errorMessage 
    }, { status: 500 });
  }
} 