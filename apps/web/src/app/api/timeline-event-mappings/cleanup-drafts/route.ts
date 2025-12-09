import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { userId, synthesis_session_id } = await req.json();

    if (!userId) {
      return NextResponse.json({ 
        error: 'Missing required parameter', 
        details: 'userId is required' 
      }, { status: 400 });
    }

    let deletedCount = 0;

    // Clean up draft annotations from raw_timeline_event_annotations
    if (synthesis_session_id) {
      // Delete by session ID if provided
      const { count: rawCount, error: rawError } = await supabase
        .from('raw_timeline_event_annotations')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('synthesis_session_id', synthesis_session_id)
        .eq('annotation_status', 'draft');

      if (rawError) {
        console.error('Error deleting raw timeline annotations by session:', rawError);
        return NextResponse.json({ 
          error: 'Failed to delete raw timeline annotations', 
          details: rawError.message 
        }, { status: 500 });
      }

      deletedCount += rawCount || 0;

      // Clean up draft annotations from timeline_event_annotations
      const { count: annotationCount, error: annotationError } = await supabase
        .from('timeline_event_annotations')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('synthesis_session_id', synthesis_session_id)
        .eq('annotation_status', 'draft');

      if (annotationError) {
        console.error('Error deleting timeline annotations by session:', annotationError);
        return NextResponse.json({ 
          error: 'Failed to delete timeline annotations', 
          details: annotationError.message 
        }, { status: 500 });
      }

      deletedCount += annotationCount || 0;

      console.log(`[SUCCESS] Cleaned up ${deletedCount} draft timeline annotations for session: ${synthesis_session_id}`);
    } else {
      // Fallback: delete all draft annotations for user (no session tracking)
      const { count: rawCount, error: rawError } = await supabase
        .from('raw_timeline_event_annotations')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('annotation_status', 'draft');

      if (rawError) {
        console.error('Error deleting raw timeline annotations:', rawError);
        return NextResponse.json({ 
          error: 'Failed to delete raw timeline annotations', 
          details: rawError.message 
        }, { status: 500 });
      }

      deletedCount += rawCount || 0;

      const { count: annotationCount, error: annotationError } = await supabase
        .from('timeline_event_annotations')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('annotation_status', 'draft');

      if (annotationError) {
        console.error('Error deleting timeline annotations:', annotationError);
        return NextResponse.json({ 
          error: 'Failed to delete timeline annotations', 
          details: annotationError.message 
        }, { status: 500 });
      }

      deletedCount += annotationCount || 0;

      console.log(`[SUCCESS] Cleaned up ${deletedCount} draft timeline annotations for user: ${userId}`);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${deletedCount} draft timeline annotations`,
      deletedCount
    });

  } catch (error) {
    console.error('Error in cleanup-drafts:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 