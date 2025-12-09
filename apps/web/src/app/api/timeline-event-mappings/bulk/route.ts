import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function PATCH(request: NextRequest) {
  try {
    const { userId, operation, analysisIds } = await request.json();

    if (!userId || !operation || !analysisIds || !Array.isArray(analysisIds)) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, operation, analysisIds' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Handle different bulk operations
    if (operation === 'delete') {
      const { error } = await supabaseAdmin
        .from('raw_timeline_event_annotations')
        .delete()
        .eq('user_id', userId)
        .in('analysis_id', analysisIds);

      if (error) {
        console.error('Error deleting timeline annotations:', error);
        return NextResponse.json(
          { error: 'Failed to delete timeline annotations' },
          { status: 500 }
        );
      }

      return NextResponse.json({ 
        success: true, 
        message: `Deleted ${analysisIds.length} annotations` 
      });
    }

    // Add other bulk operations as needed
    return NextResponse.json(
      { error: `Unsupported operation: ${operation}` },
      { status: 400 }
    );

  } catch (error) {
    console.error('Error in bulk timeline mappings operation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 