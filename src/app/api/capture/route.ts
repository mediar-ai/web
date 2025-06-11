import { NextResponse } from 'next/server';
import { 
    analyzeMultiActivityEvent, 
    analyzeUIDiff, 
    analyzeWorkflow, 
    performInitialFrameDump
} from '@/lib/analysis';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
        image, 
        image1_dataUrl, 
        image2_dataUrl, 
        prompt, 
        history, 
        analysisType,
        activitiesSummary,
        previousEvents 
    } = body;

    switch (analysisType) {
      case 'multi_activity_event':
        if (!activitiesSummary) return NextResponse.json({ error: 'No activities provided for analysis.' }, { status: 400 });
        const eventAnalysis = await analyzeMultiActivityEvent(activitiesSummary, previousEvents || [], prompt);
        return NextResponse.json({ analysis: eventAnalysis });
      
      case 'ui_diff':
        if (!image1_dataUrl || !image2_dataUrl) return NextResponse.json({ error: 'Missing images for UI Diff.' }, { status: 400 });
        const diffAnalysis = await analyzeUIDiff(image1_dataUrl, image2_dataUrl, prompt);
        return NextResponse.json({ analysis: diffAnalysis });

      case 'workflow':
        if (!image) return NextResponse.json({ error: 'No image provided for workflow analysis.' }, { status: 400 });
        const workflowAnalysis = await analyzeWorkflow(image, history || [], prompt);
        return NextResponse.json({ analysis: workflowAnalysis });
        
      case 'initial_frame_dump':
        if (!image) return NextResponse.json({ error: 'No image provided for frame dump.' }, { status: 400 });
        const dumpStream = await performInitialFrameDump(image);
        return new NextResponse(dumpStream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

      default:
        return NextResponse.json({ error: 'Invalid analysis type.' }, { status: 400 });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error(`[API/capture] Error: ${errorMessage}`);
    return NextResponse.json({ error: 'Failed to process capture request.', details: errorMessage }, { status: 500 });
  }
}